/**
 * DB metadata route'ları:
 *   GET /db/:database/size   — DB disk boyutu
 *   GET /db/:database/stats  — Tablo bazlı satır sayısı + boyut
 */

import type { FastifyInstance } from "fastify";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { scopeGuard } from "../../middleware/scopeGuard.js";
import { TTL } from "../../services/cacheService.js";

export async function metaRoute(server: FastifyInstance) {
  // GET /db/:database/size
  server.get(
    "/:database/size",
    {
      preHandler: [scopeGuard("read")],
      schema: {
        description: "Get database disk size",
        tags: ["metadata"],
      },
    },
    asyncHandler(async (req, reply) => {
      const dbName = req.dbName!;
      const cacheKey = server.cache.buildKey(dbName, "size");

      const cached = await server.cache.get(cacheKey);
      if (cached) return reply.send(JSON.parse(cached));

      const sql = server.poolManager.getPool(dbName);
      const [result] = await sql`
        SELECT
          pg_database_size(current_database()) AS size_bytes,
          pg_size_pretty(pg_database_size(current_database())) AS size_human
      `;

      await server.cache.set(cacheKey, JSON.stringify(result), TTL.DB_SIZE);
      return reply.send(result);
    })
  );

  // GET /db/:database/stats
  server.get(
    "/:database/stats",
    {
      preHandler: [scopeGuard("read")],
      schema: {
        description: "Table-level statistics: row count, size",
        tags: ["metadata"],
      },
    },
    asyncHandler(async (req, reply) => {
      const dbName = req.dbName!;
      const cacheKey = server.cache.buildKey(dbName, "stats");

      const cached = await server.cache.get(cacheKey);
      if (cached) return reply.send(JSON.parse(cached));

      const sql = server.poolManager.getPool(dbName);
      const tables = await sql`
        SELECT
          t.table_name AS name,
          c.reltuples::bigint AS estimated_row_count,
          pg_size_pretty(pg_total_relation_size(c.oid)) AS total_size,
          pg_size_pretty(pg_relation_size(c.oid)) AS table_size,
          pg_size_pretty(pg_total_relation_size(c.oid) - pg_relation_size(c.oid)) AS index_size
        FROM information_schema.tables t
        JOIN pg_class c ON c.relname = t.table_name
        WHERE t.table_schema = 'public'
          AND t.table_type = 'BASE TABLE'
        ORDER BY pg_total_relation_size(c.oid) DESC
      `;

      const result = { database: dbName, tables };
      await server.cache.set(cacheKey, JSON.stringify(result), TTL.DB_SIZE);
      return reply.send(result);
    })
  );
}
