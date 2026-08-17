/**
 * CHANGELOG.md parse helper.
 *
 * CHANGELOG.md is bundled at build time via Vite's `?raw` import.
 * No API request is needed at runtime.
 *
 * Format assumption: Keep a Changelog
 *   ## [version] — YYYY-MM-DD
 *   ### Section
 *   - item
 */

export interface ChangelogEntry {
  version: string;
  date: string;
  /** Each section: title + items */
  sections: ChangelogSection[];
  /** Raw markdown (for fallback render) */
  raw: string;
}

export interface ChangelogSection {
  title: string;
  items: string[];
}

/**
 * Parses a CHANGELOG.md raw string.
 * Each `## [x.y.z]` block becomes one entry.
 */
export function parseChangelog(raw: string): ChangelogEntry[] {
  const entries: ChangelogEntry[] = [];

  // ## [version] — date  or  ## [version] - date
  const versionRegex = /^## \[([^\]]+)\]\s*[—\-]\s*(.+)$/m;
  // Split blocks by ##
  const blocks = raw.split(/^(?=## \[)/m).filter((b) => b.trim());

  for (const block of blocks) {
    const header = block.split("\n")[0].trim();
    const match = header.match(versionRegex);
    if (!match) continue;

    const version = match[1].trim();
    const date = match[2].trim();
    const body = block.slice(header.length).trim();
    const sections = parseSections(body);

    entries.push({ version, date, sections, raw: body });
  }

  return entries;
}

function parseSections(body: string): ChangelogSection[] {
  const sections: ChangelogSection[] = [];
  // Split by ### headings
  const parts = body.split(/^(?=### )/m).filter((p) => p.trim());

  for (const part of parts) {
    const lines = part.split("\n");
    const title = lines[0].replace(/^###\s*/, "").trim();
    const items = lines
      .slice(1)
      .map((l) => l.replace(/^[-*]\s*/, "").trim())
      .filter((l) => l.length > 0);
    if (title) sections.push({ title, items });
  }

  return sections;
}

/** Returns the latest version entry (first entry). */
export function latestEntry(entries: ChangelogEntry[]): ChangelogEntry | null {
  return entries[0] ?? null;
}

/** localStorage key — which version's modal has been seen */
export const SEEN_VERSION_KEY = "postgrify_seen_version";