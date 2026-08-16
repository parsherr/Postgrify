/**
 * scripts/scrape-endpoints.ts
 *
 * Scrapes all Fastify route files under packages/api/src/routes/ and produces
 * endpoints.md at the repo root.
 *
 * Detection strategy:
 *  - Route calls: server.get/post/put/patch/delete/route(…)
 *  - Auth: scan the route's option-object brace block (up to closing }) for
 *    preHandler patterns, then fall back to group-level inherited auth.
 *  - Description: JSDoc / line-comment immediately above the route call,
 *    with ASCII-art and route-echo lines stripped.
 *
 * Run:  npx tsx scripts/scrape-endpoints.ts
 */

import fs from "fs";
import path from "path";

// ---------------------------------------------------------------------------
// Canonical prefix table — derived from routes/index.ts register() calls.
// ---------------------------------------------------------------------------
const PREFIX_TABLE: Array<{ match: string; prefix: string }> = [
  // db/auth files register routes as "/:database/auth/..." relative to the /db prefix.
  // Their parent index registers them under server.register(authDbRoutes, { prefix: "/db" }),
  // so the correct base is /db — not /db/:database/auth.
  { match: "routes/db/auth/", prefix: "/db" },
  { match: "routes/db/", prefix: "/db/:database" },
  { match: "routes/auth/", prefix: "/auth" },
  { match: "routes/admin/", prefix: "/admin" },
  { match: "routes/health.ts", prefix: "" },   // absolute paths: /health, /admin/health
  { match: "routes/setup.ts", prefix: "/setup" },
  { match: "routes/terminal.ts", prefix: "/terminal" },
];

function groupPrefixFor(relToSrc: string): string {
  const norm = relToSrc.replace(/\\/g, "/");
  const sorted = [...PREFIX_TABLE].sort((a, b) => b.match.length - a.match.length);
  for (const { match, prefix } of sorted) {
    if (norm.startsWith(match) || norm === match) return prefix;
  }
  return "";
}

// ---------------------------------------------------------------------------
// Group-level inherited auth.
// Each index.ts that calls server.addHook("preHandler", …) applies to all
// routes registered under it. We encode that here.
// ---------------------------------------------------------------------------
const INHERITED_AUTH: Array<{ match: string; auth: string }> = [
  // admin/index.ts: addHook("preHandler", server.authenticateAdmin)
  { match: "routes/admin/", auth: "Admin token" },
  // db/index.ts: addHook("preHandler", server.authenticateAny)
  // rows.ts uses scopeGuard per-route so detection covers it; others need the fallback.
  { match: "routes/db/backup.ts", auth: "Admin/DB token" },
  { match: "routes/db/meta.ts", auth: "Admin/DB token" },
  { match: "routes/db/query.ts", auth: "Admin/DB token" },
  { match: "routes/db/tables.ts", auth: "Admin/DB token" },
  { match: "routes/db/upload.ts", auth: "Admin/DB token" },
];

function inheritedAuthFor(relToSrc: string): string | null {
  const norm = relToSrc.replace(/\\/g, "/");
  const sorted = [...INHERITED_AUTH].sort((a, b) => b.match.length - a.match.length);
  for (const { match, auth } of sorted) {
    if (norm.startsWith(match) || norm === match) return auth;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Route extraction
// ---------------------------------------------------------------------------

interface RawRoute {
  method: string;
  partialUrl: string;
  /** character index of the match in source */
  charIdx: number;
  /** the full text of the route's options object (the {...} argument), if found */
  optionsBlock: string;
  /** broader slice of source covering options + handler body for inline auth detection */
  fullRouteText: string;
}

/**
 * Extract the text of the balanced {...} block starting at `start` in `source`.
 * Returns empty string if not found within `maxChars`.
 */
function extractBraceBlock(source: string, start: number, maxChars = 4000): string {
  let depth = 0;
  let i = start;
  const end = Math.min(start + maxChars, source.length);
  while (i < end) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
    i++;
  }
  return "";
}

function extractRawRoutes(source: string): RawRoute[] {
  const results: RawRoute[] = [];

  // Shorthand: server.METHOD('url', { … })  or  server.METHOD('url', opts, handler)
  const shortRe =
    /(?:server|fastify|app)\.(get|post|put|patch|delete|head|options)\s*\(\s*['"`]([^'"`\n]+)['"`]\s*,\s*(\{)/gi;
  let m: RegExpExecArray | null;

  shortRe.lastIndex = 0;
  while ((m = shortRe.exec(source)) !== null) {
    const braceStart = m.index + m[0].length - 1; // position of the opening {
    const optionsBlock = extractBraceBlock(source, braceStart);
    // Grab ~2000 chars after the options block for inline handler auth checks
    const afterBlock = optionsBlock
      ? source.slice(braceStart, braceStart + optionsBlock.length + 2000)
      : source.slice(m.index, m.index + 3000);
    results.push({
      method: m[1].toUpperCase(),
      partialUrl: m[2],
      charIdx: m.index,
      optionsBlock,
      fullRouteText: afterBlock,
    });
  }

  // Shorthand without options object: server.METHOD('url', handler)
  const shortNoOpts =
    /(?:server|fastify|app)\.(get|post|put|patch|delete|head|options)\s*\(\s*['"`]([^'"`\n]+)['"`]\s*,\s*(?!{)/gi;
  shortNoOpts.lastIndex = 0;
  while ((m = shortNoOpts.exec(source)) !== null) {
    const alreadyCaptured = results.some(
      (r) => r.charIdx === m!.index
    );
    if (!alreadyCaptured) {
      results.push({
        method: m[1].toUpperCase(),
        partialUrl: m[2],
        charIdx: m.index,
        optionsBlock: "",
        fullRouteText: source.slice(m.index, m.index + 3000),
      });
    }
  }

  // .route({ method, url }) — method before url
  const routeMfirstRe =
    /(?:server|fastify|app)\.route\s*\(\s*(\{)/gs;
  routeMfirstRe.lastIndex = 0;
  while ((m = routeMfirstRe.exec(source)) !== null) {
    const braceStart = m.index + m[0].length - 1;
    const block = extractBraceBlock(source, braceStart);
    if (!block) continue;
    const methodM = block.match(/\bmethod\s*:\s*['"`]([A-Z]+)['"`]/);
    const urlM = block.match(/\burl\s*:\s*['"`]([^'"`\n]+)['"`]/);
    if (!methodM || !urlM) continue;
    results.push({
      method: methodM[1].toUpperCase(),
      partialUrl: urlM[1],
      charIdx: m.index,
      optionsBlock: block,
      fullRouteText: source.slice(m.index, m.index + block.length + 2000),
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Description extraction
// ---------------------------------------------------------------------------

function extractDescription(lines: string[], lineIdx: number): string {
  const commentLines: string[] = [];
  let i = lineIdx - 1;
  let skippedBlanks = 0;

  while (i >= 0 && skippedBlanks <= 1) {
    const line = lines[i].trim();
    if (line === "") { skippedBlanks++; i--; continue; }
    skippedBlanks = 0;

    if (line.startsWith("//")) {
      commentLines.unshift(line.replace(/^\/\/\s*/, ""));
      i--;
    } else if (line.startsWith("*") && !line.startsWith("*/")) {
      commentLines.unshift(line.replace(/^\*+\s*/, ""));
      i--;
    } else if (line === "/**" || line === "/*") {
      i--;
    } else {
      break;
    }
  }

  const cleaned = commentLines
    .map((l) => {
      let s = l
        .replace(/^[─│┈┉─\s]+/, "")
        .replace(/[─│┈┉─\s]+$/, "")
        .trim();

      // Strip "METHOD /path — description" lines (just route echoes)
      const routeEchoRe =
        /^(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+\/[^\s]*(?:\s+[—–-]+\s+(.+))?$/i;
      const echoMatch = routeEchoRe.exec(s);
      if (echoMatch) {
        s = echoMatch[1]?.trim() ?? "";
      }

      // Strip pure repetition of HTTP verb at start (e.g. "POST /setup — …")
      return s;
    })
    .filter(
      (l) =>
        l.length > 0 &&
        !/^[─\-─\s]+$/.test(l) &&
        !l.startsWith("@") &&
        l !== "/"
    );

  return cleaned.join(" ").trim();
}

// ---------------------------------------------------------------------------
// Auth detection — uses the route's extracted options block
// ---------------------------------------------------------------------------

function detectAuth(
  optionsBlock: string,
  relToSrc: string,
  /** broader slice: file header + options block + handler body */
  fullRouteText: string
): string {
  // ── 1. Explicit preHandler in the route's options block ──────────────────
  // These are definitive — if present, they always win.

  const hasScopeGuard = /scopeGuard\s*\(/.test(optionsBlock);
  const scopeMatch = optionsBlock.match(/scopeGuard\s*\(\s*['"`]([^'"`]+)['"`]/);

  if (/authenticateAdmin/.test(optionsBlock)) {
    return hasScopeGuard && scopeMatch
      ? `Admin + scope:${scopeMatch[1]}`
      : "Admin token";
  }
  if (/authenticateAny/.test(optionsBlock)) {
    return hasScopeGuard && scopeMatch
      ? `DB token (scope:${scopeMatch[1]})`
      : "Admin/DB token";
  }
  if (/server\.authenticate(?!Admin|Any)/.test(optionsBlock)) {
    return hasScopeGuard && scopeMatch
      ? `DB token (scope:${scopeMatch[1]})`
      : "Admin token";
  }
  if (hasScopeGuard && scopeMatch) {
    // scopeGuard referenced in options via a variable (e.g. ...adminGuard)
    return `DB token (scope:${scopeMatch[1]})`;
  }

  // ── 2. Variable-based preHandler: guard arrays referenced by name ─────────
  // Pattern A (sessions.ts, audit.ts):
  //   const adminGuard = [server.authenticate, scopeGuard("schema")] as const;
  //   preHandler: [...adminGuard]
  // Pattern B (settings.ts):
  //   const adminGuard = (server) => [server.authenticate, scopeGuard("schema")]
  //   preHandler: [...adminGuard(server)]
  // Pattern C (users.ts):
  //   function authGuard(server, scope) { return [server.authenticate, scopeGuard(scope)] }
  //   preHandler: [...authGuard(server, "read")]
  //
  // For patterns A/B the guard variable name always appears in the options block.
  // The actual scopeGuard call lives in the file header (captured in fullRouteText).
  const hasAdminGuardRef = /adminGuard|authGuard/.test(optionsBlock);
  // For authGuard(server, "scope") the scope literal is inside the options block itself
  const authGuardCallMatch = optionsBlock.match(
    /authGuard\s*\([^,)]+,\s*['"`]([^'"`]+)['"`]/
  );
  if (authGuardCallMatch) {
    return `DB token (scope:${authGuardCallMatch[1]})`;
  }
  // For adminGuard (fixed scope in guard definition), derive scope from file header
  if (hasAdminGuardRef) {
    const fullScopeMatch = fullRouteText.match(
      /scopeGuard\s*\(\s*['"`]([^'"`]+)['"`]/
    );
    if (fullScopeMatch) return `DB token (scope:${fullScopeMatch[1]})`;
    return "DB token";
  }

  // ── 3. Inline handler auth (no preHandler decorator) ─────────────────────
  // auth/me.ts, auth/sessions.ts, auth/refresh.ts etc. call
  //   server.jwtService.verifyAdminOrDb(token)   → requires admin/DB token
  //   jwtService.verifyDbUser(token)             → requires DB user token
  if (/verifyAdminOrDb/.test(fullRouteText)) return "Admin token";
  if (/verifyDbUser/.test(fullRouteText)) return "DB user token";

  // ── 4. Group-level inherited auth ────────────────────────────────────────
  const inherited = inheritedAuthFor(relToSrc);
  if (inherited) return inherited;

  return "Public";
}

// ---------------------------------------------------------------------------
// URL normalization
// ---------------------------------------------------------------------------

function buildFullUrl(groupPrefix: string, partialUrl: string): string {
  let url: string;

  if (!groupPrefix) {
    url = partialUrl;
  } else if (partialUrl === "/" || partialUrl === "") {
    url = groupPrefix;
  } else if (partialUrl.startsWith(groupPrefix)) {
    url = partialUrl;
  } else {
    url = groupPrefix + (partialUrl.startsWith("/") ? partialUrl : "/" + partialUrl);
  }

  url = url.replace(/\/+/g, "/");
  // Collapse duplicate :database param injected by prefix + partial URL
  url = url.replace(/\/:database\/:database\b/g, "/:database");
  if (url.length > 1 && url.endsWith("/")) url = url.slice(0, -1);
  return url;
}

// ---------------------------------------------------------------------------
// Group helpers
// ---------------------------------------------------------------------------

function groupLabel(key: string): string {
  const labels: Record<string, string> = {
    health: "Health",
    setup: "Setup",
    auth: "Admin Auth",
    admin: "Admin",
    db: "Database Data",
    "db/auth": "Per-DB Auth",
    terminal: "Terminal",
  };
  return labels[key] ?? key;
}

function groupKeyFor(relToRoutes: string): string {
  const norm = relToRoutes.replace(/\\/g, "/");
  if (norm.startsWith("db/auth/")) return "db/auth";
  if (norm.startsWith("db/")) return "db";
  if (norm.startsWith("auth/")) return "auth";
  if (norm.startsWith("admin/")) return "admin";
  return norm.replace(/\.ts$/, "");
}

const GROUP_ORDER = ["health", "setup", "auth", "admin", "db", "db/auth", "terminal"];

// ---------------------------------------------------------------------------
// Walk
// ---------------------------------------------------------------------------

function walkTs(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkTs(full));
    else if (entry.isFile() && entry.name.endsWith(".ts")) out.push(full);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

interface Endpoint {
  method: string;
  url: string;
  description: string;
  auth: string;
  file: string;
}

const REPO_ROOT = path.resolve(__dirname, "..");
const ROUTES_DIR = path.join(REPO_ROOT, "packages/api/src/routes");
const SRC_DIR = path.join(REPO_ROOT, "packages/api/src");
const OUT_FILE = path.join(REPO_ROOT, "endpoints.md");

const SKIP_FILES = new Set(["index.ts", "provision.ts"]);

const groups = new Map<string, Endpoint[]>();

const allFiles = walkTs(ROUTES_DIR).filter(
  (f) => !SKIP_FILES.has(path.basename(f))
);

for (const filePath of allFiles) {
  const source = fs.readFileSync(filePath, "utf8");
  const lines = source.split("\n");
  const relToSrc = path.relative(SRC_DIR, filePath).replace(/\\/g, "/");
  const relToRoutes = path.relative(ROUTES_DIR, filePath).replace(/\\/g, "/");

  const prefix = groupPrefixFor(relToSrc);
  const key = groupKeyFor(relToRoutes);
  const rawRoutes = extractRawRoutes(source);

  // Capture the entire file source as context for guard variable definitions.
  // Guards like adminGuard / authGuard are defined at file or function scope and
  // their scopeGuard("…") call must be visible to detectAuth regardless of which
  // route in the file we are currently processing.
  const fullFileSource = source;

  for (const { method, partialUrl, charIdx, optionsBlock, fullRouteText } of rawRoutes) {
    const lineIdx = source.slice(0, charIdx).split("\n").length - 1;
    const url = buildFullUrl(prefix, partialUrl);
    const description = extractDescription(lines, lineIdx);
    // Use the entire file so guard definitions are always reachable
    const combinedText = fullFileSource + "\n" + fullRouteText;
    const auth = detectAuth(optionsBlock, relToSrc, combinedText);

    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push({
      method,
      url,
      description,
      auth,
      file: `packages/api/src/${relToSrc}`,
    });
  }
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

const sortedKeys = [...groups.keys()].sort((a, b) => {
  const ai = GROUP_ORDER.indexOf(a);
  const bi = GROUP_ORDER.indexOf(b);
  if (ai === -1 && bi === -1) return a.localeCompare(b);
  if (ai === -1) return 1;
  if (bi === -1) return -1;
  return ai - bi;
});

let md = `# Postgrify API Endpoints

> Auto-generated by \`scripts/scrape-endpoints.ts\` — do not edit by hand.
> Run \`npx tsx scripts/scrape-endpoints.ts\` to regenerate.

## Table of Contents

`;

for (const key of sortedKeys) {
  const label = groupLabel(key);
  const anchor = label.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  md += `- [${label}](#${anchor})\n`;
}

md += "\n---\n\n";

let totalEndpoints = 0;

for (const key of sortedKeys) {
  const label = groupLabel(key);
  const endpoints = groups.get(key)!;

  const seen = new Set<string>();
  const deduped = endpoints.filter((e) => {
    const k = `${e.method}:${e.url}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  deduped.sort((a, b) =>
    a.url === b.url ? a.method.localeCompare(b.method) : a.url.localeCompare(b.url)
  );

  totalEndpoints += deduped.length;

  md += `## ${label}\n\n`;
  md += `| Method | URL | Auth | Description | Source |\n`;
  md += `|--------|-----|------|-------------|--------|\n`;

  for (const ep of deduped) {
    const desc = ep.description || "—";
    const src = `[\`${path.basename(ep.file)}\`](${ep.file})`;
    md += `| \`${ep.method}\` | \`${ep.url}\` | ${ep.auth} | ${desc} | ${src} |\n`;
  }

  md += "\n";
}

md += `---\n\n*Total endpoints: ${totalEndpoints}*\n`;

fs.writeFileSync(OUT_FILE, md, "utf8");
console.log(`✅  Written to ${OUT_FILE}`);
console.log(`   Groups: ${sortedKeys.length}  |  Endpoints: ${totalEndpoints}`);
