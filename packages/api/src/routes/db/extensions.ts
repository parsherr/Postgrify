/**
 * PostgreSQL extension management (E-76 / E-77 / E-78):
 *   GET    /db/:database/extensions
 *   POST   /db/:database/extensions      (E-77 — later)
 *   DELETE /db/:database/extensions/:ext (E-78 — later)
 *
 * Auth: schema scope (admin bypasses).
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
          "Install a PostgreSQL extension (CREATE EXTENSION IF NOT EXISTS). " +
          "Returns 201 with installed extension info; 404 if not available on server.",
        tags: ["schema"],
        body: {
          type: "object",
          required: ["name"],
          properties: { name: { type: "string" } },
        },
        response: {
          201: {
            type: "object",
            properties: {
              name:              { type: "string" },
              created:           { type: "boolean" },
              installed_version: { type: ["string", "null"] },
              default_version:   { type: ["string", "null"] },
              installed:         { type: "boolean" },
            },
          },
        },
      },
    },
    asyncHandler(async (req, reply) => {
      const dbName = req.dbName!;
      const { name } = req.body as { name: string };

      try {
        assertExtensionName(name);
      } catch (err) {
        return reply.status(400).send({ error: (err as Error).message });
      }

      const sql = server.poolManager.getPool(dbName);

      try {
        await sql.unsafe(`CREATE EXTENSION IF NOT EXISTS "${name}"`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/is not available|could not open extension/i.test(msg)) {
          return reply.status(404).send({ error: "Extension not available on this server", name });
        }
        throw err;
      }

      // Invalidate extensions cache after install.
      await server.cache.del(server.cache.buildKey(dbName, "extensions"));

      const [row] = await sql`
        SELECT name, installed_version, default_version,
               (installed_version IS NOT NULL) AS installed
        FROM pg_catalog.pg_available_extensions
        WHERE name = ${name}
      `;

      return reply.status(201).send({
        name: row ? String(row.name) : name,
        created: true,
        installed_version: row?.installed_version ?? null,
        default_version:   row?.default_version ?? null,
        installed:         row ? Boolean(row.installed) : true,
      });
    })
  );

  // ── E-78 DELETE /extensions/:ext ──────────────────────────────────────────
  server.delete(
    "/:database/extensions/:ext",
    {
      preHandler: [scopeGuard("schema")],
      schema: {
        description:
          "Drop a PostgreSQL extension (E-78): DROP EXTENSION IF EXISTS. " +
          "Refuses dropping plpgsql. Dependent objects without CASCADE → 409.",
        tags: ["schema"],
        params: {
          type: "object",
          required: ["database", "ext"],
          properties: {
            database: { type: "string" },
            ext:      { type: "string" },
          },
        },
      },
    },
    asyncHandler(async (req, reply) => {
      const dbName = req.dbName!;
      const { ext } = req.params as { ext: string };

      try {
        assertExtensionName(ext);
      } catch (e) {
        return reply.status(400).send({
          error: e instanceof Error ? e.message : String(e),
        });
      }

      // plpgsql is required for normal PostgreSQL operation — never drop via API.
      if (ext.toLowerCase() === "plpgsql") {
        return reply.status(400).send({
          error: "Cannot drop the required plpgsql extension",
          name: ext,
        });
      }

      const sql = server.poolManager.getPool(dbName);
      try {
        await sql.unsafe(`DROP EXTENSION IF EXISTS "${ext}"`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (/dependent objects|cannot drop extension/i.test(msg)) {
          return reply.status(409).send({
            error: "Extension has dependent objects; drop them first or use CASCADE manually",
            name: ext,
          });
        }
        throw e;
      }

      await server.cache.del(server.cache.buildKey(dbName, "extensions"));

      return reply.send({ name: ext, dropped: true });
    })
  );
}
