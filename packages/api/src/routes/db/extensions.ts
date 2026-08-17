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
}
