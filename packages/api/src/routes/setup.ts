/**
 * Setup Route — first-run wizard endpoints.
 *
 * GET  /setup/status → { configured: boolean }
 * POST /setup        → create admin account + PostgreSQL connection
 *
 * Docker behaviour:
 *   Writing to .env inside a container usually fails (EACCES or file outside
 *   a mounted volume). In that case admin credentials are injected into
 *   process.env (works for the current runtime) and also persisted to PostgreSQL.
 *   On container restart they are reloaded from the DB — the pool plugin
 *   onReady hook handles this.
 *
 * Security:
 *   - POST /setup runs only once; subsequent calls return 403
 *   - Password is hashed with argon2id (memoryCost=64MB, timeCost=3, parallelism=4)
 *   - .env is written atomically: tmp → rename (prevents partial writes)
 *   - A JWT token is returned in the setup response so the GUI can log in
 *     immediately — the login endpoint may not see new env vars in a container
 */

import fs from "node:fs";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { hashPassword } from "../services/passwordService.js";
import { config } from "../config/env.js";
import { JwtService } from "../services/jwtService.js";

// ── In-memory setup flag ──────────────────────────────────────────────────────
// null   = not yet checked
// false  = setup not completed
// true   = setup completed (confirmed from env var or DB)
let _setupCompleted: boolean | null = null;

/**
 * Async check used by /setup/status and the POST /setup guard.
 *
 * Validation order:
 *   1. In-memory flag → fast path (setup was completed in the same process)
 *   2. Admin credentials present in DB? → authoritative source.
 *      This check intentionally bypasses env vars because `docker compose down -v`
 *      wipes the volume but leaves the host .env intact — if the env var holds a
 *      hash but the DB has no admin, the setup page must be shown.
 *   3. DB unreachable (no decorator or connection error) → fall back to env var.
 *      This keeps local development working without a DB.
 */
async function isConfiguredAsync(server?: FastifyInstance): Promise<boolean> {
  // Fast path: setup was completed in this process, skip the DB call
  if (_setupCompleted === true) return true;

  // Authoritative source: does a real admin record exist in the DB?
  if (server?.hasDecorator("settings")) {
    try {
      const creds = await server.settings.getAdminCredentials();
      if (creds) {
        _setupCompleted = true;
        return true;
      }
      // DB reachable but no admin found — setup is definitely required
      return false;
    } catch {
      // DB unreachable — fall back to env var (local dev / DB not ready yet)
    }
  }

  // Fallback: check env var (no DB decorator or connection error)
  const configured = Boolean(config.ADMIN_EMAIL && config.ADMIN_PASSWORD_HASH);
  if (configured) _setupCompleted = true;
  return configured;
}

/** Updates the in-memory flag after setup has completed. */
function markSetupComplete(): void {
  _setupCompleted = true;
}

/**
 * Resets the in-memory _setupCompleted flag to null.
 *
 * Must only be used in the test environment.
 * Prevents state pollution when each test creates its own isolated server instance.
 *
 * @internal — test-only
 */
export function _resetSetupFlag(): void {
  _setupCompleted = null;
}

/**
 * Atomically writes the .env file: first write to a tmp file, then rename.
 * Prevents partial writes under concurrent requests.
 */
function writeEnvFileAtomic(envPath: string, content: string): void {
  const tmpPath = path.join(path.dirname(envPath), `.postgrify-env-${process.pid}-${Date.now()}.tmp`);
  try {
    fs.writeFileSync(tmpPath, content, { encoding: "utf8", mode: 0o600 });
    fs.renameSync(tmpPath, envPath);
  } catch (err) {
    // Cleanup tmp file on failure
    try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    throw err;
  }
}

function resolveEnvPath(): string {
  // Walk up from the API working directory (packages/api → packages)
  const candidates = [
    path.resolve(process.cwd(), ".env"),
    path.resolve(process.cwd(), "..", ".env"),
    path.resolve(process.cwd(), "..", "..", "packages", ".env"),
  ];

  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }

  // Not found — create alongside packages/
  return path.resolve(process.cwd(), "..", ".env");
}

/** Parses the .env file line by line → Map<key, raw-line-index> */
function parseEnvFile(content: string): Map<string, number> {
  const map = new Map<string, number>();
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith("#")) continue;
    const eqIdx = line.indexOf("=");
    if (eqIdx === -1) continue;
    map.set(line.slice(0, eqIdx).trim(), i);
  }
  return map;
}

/**
 * Updates keys in the .env file or appends them at the end.
 * Preserves the order of existing lines and comments.
 */
function updateEnvContent(existing: string, updates: Record<string, string>): string {
  const lines = existing.split("\n");
  const lineIndex = parseEnvFile(existing);

  for (const [key, value] of Object.entries(updates)) {
    const idx = lineIndex.get(key);
    if (idx !== undefined) {
      lines[idx] = `${key}=${value}`;
    } else {
      // Append at the end (before any trailing blank line)
      lines.push(`${key}=${value}`);
    }
  }

  return lines.join("\n");
}

export async function setupRoutes(server: FastifyInstance) {
  // ──────────────────────────────────────────────
  // GET /setup/status
  // ──────────────────────────────────────────────
  server.get(
    "/status",
    {
      schema: {
        description: "Returns whether initial setup has been completed.",
        tags: ["setup"],
        security: [],
        response: {
          200: {
            type: "object",
            properties: {
              configured: { type: "boolean" },
            },
          },
        },
      },
    },
    async (_req, reply) => {
      // Also check the DB — env var may have been lost after a container restart
      const configured = await isConfiguredAsync(server);
      return reply.send({ configured });
    }
  );

  // ──────────────────────────────────────────────
  // POST /setup
  // ──────────────────────────────────────────────
  server.post(
    "/",
    {
      schema: {
        description: "Initial setup: save admin credentials and PostgreSQL connection to .env.",
        tags: ["setup"],
        security: [],
        body: {
          type: "object",
          required: ["adminEmail", "adminPassword", "pgHost", "pgPort", "pgUser", "pgPassword"],
          additionalProperties: false,
          properties: {
            adminEmail: {
              type: "string",
              format: "email",
              description: "Admin email address",
            },
            adminPassword: {
              type: "string",
              minLength: 8,
              description: "Admin password (min 8 characters)",
            },
            pgHost: { type: "string", minLength: 1 },
            pgPort: { type: "integer", minimum: 1, maximum: 65535 },
            pgUser: { type: "string", minLength: 1 },
            pgPassword: { type: "string", minLength: 1 },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              ok: { type: "boolean" },
              message: { type: "string" },
              accessToken: { type: "string" },
              refreshToken: { type: "string", nullable: true },
              email: { type: "string" },
            },
          },
        },
      },
    },
    async (req, reply) => {
      // Already configured — locked (check includes DB)
      if (await isConfiguredAsync(server)) {
        return reply.status(403).send({ error: "Setup already completed" });
      }

      const { adminEmail, adminPassword, pgHost, pgPort, pgUser, pgPassword } =
        req.body as {
          adminEmail: string;
          adminPassword: string;
          pgHost: string;
          pgPort: number;
          pgUser: string;
          pgPassword: string;
        };

      // Hash the password
      const passwordHash = await hashPassword(adminPassword);

      // ── 1. Runtime inject: process.env + config ─────────────────────────────
      // Makes login work immediately within the same container instance.
      // Lost on container restart; DB and .env are used for permanent storage.
      process.env.ADMIN_EMAIL = adminEmail;
      process.env.ADMIN_PASSWORD_HASH = passwordHash;
      process.env.PG_HOST = pgHost;
      process.env.PG_PORT = String(pgPort);
      process.env.PG_USER = pgUser;
      process.env.PG_PASSWORD = pgPassword;

      // Also update the config object so other modules reading via config
      // do not require a restart
      (config as Record<string, unknown>).ADMIN_EMAIL = adminEmail;
      (config as Record<string, unknown>).ADMIN_PASSWORD_HASH = passwordHash;
      (config as Record<string, unknown>).PG_HOST = pgHost;
      (config as Record<string, unknown>).PG_PORT = pgPort;
      (config as Record<string, unknown>).PG_USER = pgUser;
      (config as Record<string, unknown>).PG_PASSWORD = pgPassword;

      // ── 2. Write to .env (persistent — survives rebuilds) ────────────────────
      let envWritten = false;
      try {
        const envPath = resolveEnvPath();
        const existing = fs.existsSync(envPath)
          ? fs.readFileSync(envPath, "utf8")
          : "";
        const updated = updateEnvContent(existing, {
          ADMIN_EMAIL: adminEmail,
          ADMIN_PASSWORD_HASH: passwordHash,
          PG_HOST: pgHost,
          PG_PORT: String(pgPort),
          PG_USER: pgUser,
          PG_PASSWORD: pgPassword,
        });
        writeEnvFileAtomic(envPath, updated);
        envWritten = true;
        server.log.info({ envPath }, "Setup: .env file updated");
      } catch (err) {
        // Writing .env inside a Docker container usually fails — this is expected.
        // Credentials are written to the DB; restart recovery is handled by the pool plugin onReady hook.
        server.log.warn(
          { err },
          "Setup: .env write failed (expected in Docker) — credentials will be persisted to DB"
        );
      }

      // ── 3. Persist credentials to DB (survives container restarts) ──────────
      // Stored in the PostgreSQL volume. After docker compose down (without -v)
      // → up --build, the pool plugin loads them in onReady.
      if (server.hasDecorator("settings")) {
        try {
          await server.settings.setAdminCredentials(adminEmail, passwordHash);
          await server.settings.setAdminSetupCompleted();
          server.log.info("Setup: admin credentials persisted to DB");
        } catch (dbErr) {
          server.log.warn(
            { err: dbErr },
            "Setup: DB write failed — only env-based detection active"
          );
        }
      }

      // ── 4. Update in-memory flag ─────────────────────────────────────────
      markSetupComplete();

      // ── 5. Return JWT token — GUI can log in immediately ─────────────────
      // New env vars may not be visible to /auth/admin/login inside a container
      // (other route handlers hold a config snapshot). The token lets the GUI
      // open a session directly without hitting the login endpoint.
      let accessToken: string | undefined;
      let refreshToken: string | null = null;

      try {
        const jwtService = new JwtService(() => config.JWT_SECRET);
        accessToken = await jwtService.signAdminToken(config.ACCESS_TOKEN_EXPIRY, adminEmail);

        // Issue refresh token if Redis is available
        if (server.hasDecorator("sessionService")) {
          try {
            refreshToken = await (server as unknown as { sessionService: { create(email: string): Promise<string | null> } }).sessionService.create(adminEmail);
          } catch {
            // No Redis — continue without a refresh token
          }
        }
      } catch (tokenErr) {
        // JWT generation failure does not fail the setup
        server.log.warn({ err: tokenErr }, "Setup: JWT generation failed");
      }

      const message = envWritten
        ? "Setup complete. Credentials saved to .env and database."
        : "Setup complete. Credentials saved to database (Docker mode — .env not writable).";

      return reply.send({
        ok: true,
        message,
        accessToken,
        refreshToken,
        email: adminEmail,
      });
    }
  );
}