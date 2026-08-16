/**
 * PostgreSQL extension management (E-76 / E-77 / E-78):
 *   GET    /db/:database/extensions
 *   POST   /db/:database/extensions
 *   DELETE /db/:database/extensions/:ext (E-78 — later)
 *
 * Auth: schema scope (admin bypasses).
 *
 * Extension names may include hyphens (e.g. uuid-ossp) and pg_* prefixes
 * (e.g. pg_trgm) — unlike table/schema identifiers.
 */

import type { FastifyInstance } from "fastify";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { scopeGuard } from "../../middleware/scopeGuard.js";
import { TTL } from "../../services/cacheService.js";

/** Extension control-file names: letters, digits, underscore, hyphen. */
const EXTENSION_NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_-]{0,62}$/;

function assertExtensionName(name: string): void {
  if (!EXTENSION_NAME_RE.test(name)) {
    throw new Error(
      `Invalid extension name: '${name}'. Must match /^[a-zA-Z_][a-zA-Z0-9_-]{0,62}$/.`
    );
  }
}

export async function extensionsRoute(server: FastifyInstance) {
  // ── E-76 GET /extensions ──────────────────────────────────────────────────
  server.get(
    "/:database/extensions",
    {
      preHandler: [scopeGuard("schema")],
      schema: {
        description:
          "List available PostgreSQL extensions (installed + installable). " +
          "Shape: name, installed_version, default_version, installed.",
        tags: ["schema"],
        params: {
          type: "object",
          properties: { database: { type: "string" } },
        },
      },
    },
    asyncHandler(async (req, reply) => {
      const dbName = req.dbName!;
      const cacheKey = server.cache.buildKey(dbName, "extensions");
      const cached = await server.cache.get(cacheKey);
      if (cached) return reply.send(JSON.parse(cached));

      const sql = server.poolManager.getPool(dbName);
      const extensions = await sql`
        SELECT
          name,
          installed_version,
          default_version,
          (installed_version IS NOT NULL) AS installed
        FROM pg_catalog.pg_available_extensions
        ORDER BY name
      `;

      await server.cache.set(cacheKey, JSON.stringify(extensions), TTL.SCHEMA);
      return reply.send(extensions);
    })
  );

  // ── E-77 POST /extensions ─────────────────────────────────────────────────
  server.post(
    "/:database/extensions",
    {
      preHandler: [scopeGuard("schema")],
      schema: {
        description:
          "Enable a PostgreSQL extension (E-77): CREATE EXTENSION IF NOT EXISTS. " +
          "Requires schema scope. Names may include hyphens (uuid-ossp) and pg_*.",
        tags: ["schema"],
        params: {
          type: "object",
          properties: { database: { type: "string" } },
        },
        body: {
          type: "object",
          required: ["name"],
          properties: {
            name: { type: "string" },
          },
        },
      },
    },
    asyncHandler(async (req, reply) => {
      const dbName = req.dbName!;
      const { name } = req.body as { name: string };

      try {
        assertExtensionName(name);
      } catch (e) {
        return reply.status(400).send({
          error: e instanceof Error ? e.message : String(e),
        });
      }

      const sql = server.poolManager.getPool(dbName);
      try {
        await sql.unsafe(`CREATE EXTENSION IF NOT EXISTS "${name}"`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (/is not available/i.test(msg) || /could not open extension/i.test(msg)) {
          return reply.status(404).send({
            error: "Extension not available on this server",
            name,
          });
        }
        throw e;
      }

      await server.cache.del(server.cache.buildKey(dbName, "extensions"));

      const [row] = await sql`
        SELECT
          name,
          installed_version,
          default_version,
          (installed_version IS NOT NULL) AS installed
        FROM pg_catalog.pg_available_extensions
        WHERE name = ${name}
      `;

      return reply.status(201).send({
        name,
        created: true,
        installed_version: (row?.installed_version as string | null) ?? null,
        default_version: (row?.default_version as string | null) ?? null,
        installed: Boolean(row?.installed),
      });
    })
  );
}
