/**
 * Schema introspection lists (E-64 / E-68 / E-73):
 *   GET /db/:database/views
 *   GET /db/:database/functions
 *   GET /db/:database/indexes
 *
 * Auth: schema scope (admin bypasses). Public schema only — same as tables.
 */

import type { FastifyInstance } from "fastify";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { scopeGuard } from "../../middleware/scopeGuard.js";
import { TTL } from "../../services/cacheService.js";

export async function schemaListsRoute(server: FastifyInstance) {
  // ── E-64 GET /views ───────────────────────────────────────────────────────
  server.get(
    "/:database/views",
    {
      preHandler: [scopeGuard("schema")],
      schema: {
        description:
          "List views and materialized views in the public schema " +
          "(name, definition, updatable flag).",
        tags: ["schema"],
        params: {
          type: "object",
          properties: { database: { type: "string" } },
        },
      },
    },
    asyncHandler(async (req, reply) => {
      const dbName = req.dbName!;
      const cacheKey = server.cache.buildKey(dbName, "views");
      const cached = await server.cache.get(cacheKey);
      if (cached) return reply.send(JSON.parse(cached));

      const sql = server.poolManager.getPool(dbName);
      const views = await sql`
        SELECT
          n.nspname AS schema,
          c.relname AS name,
          (c.relkind = 'm') AS is_materialized,
          CASE
            WHEN c.relkind = 'v'
              THEN (pg_catalog.pg_relation_is_updatable(c.oid, false) & 4) = 4
            ELSE false
          END AS is_updatable,
          pg_catalog.pg_get_viewdef(c.oid, true) AS definition
        FROM pg_catalog.pg_class c
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relkind IN ('v', 'm')
        ORDER BY c.relname
      `;

      await server.cache.set(cacheKey, JSON.stringify(views), TTL.SCHEMA);
      return reply.send(views);
    })
  );

  // ── E-68 GET /functions ───────────────────────────────────────────────────
  server.get(
    "/:database/functions",
    {
      preHandler: [scopeGuard("schema")],
      schema: {
        description:
          "List user-defined functions and procedures in the public schema.",
        tags: ["schema"],
        params: {
          type: "object",
          properties: { database: { type: "string" } },
        },
      },
    },
    asyncHandler(async (req, reply) => {
      const dbName = req.dbName!;
      const cacheKey = server.cache.buildKey(dbName, "functions");
      const cached = await server.cache.get(cacheKey);
      if (cached) return reply.send(JSON.parse(cached));

      const sql = server.poolManager.getPool(dbName);
      const functions = await sql`
        SELECT
          n.nspname AS schema,
          p.proname AS name,
          l.lanname AS language,
          pg_catalog.pg_get_function_result(p.oid) AS return_type,
          pg_catalog.pg_get_function_arguments(p.oid) AS arguments,
          CASE p.prokind
            WHEN 'f' THEN 'function'
            WHEN 'p' THEN 'procedure'
            WHEN 'a' THEN 'aggregate'
            WHEN 'w' THEN 'window'
            ELSE p.prokind::text
          END AS kind
        FROM pg_catalog.pg_proc p
        JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
        JOIN pg_catalog.pg_language l ON l.oid = p.prolang
        WHERE n.nspname = 'public'
          AND p.prokind IN ('f', 'p')
        ORDER BY p.proname, p.oid
      `;

      await server.cache.set(cacheKey, JSON.stringify(functions), TTL.SCHEMA);
      return reply.send(functions);
    })
  );

  // ── E-73 GET /indexes ─────────────────────────────────────────────────────
  server.get(
    "/:database/indexes",
    {
      preHandler: [scopeGuard("schema")],
      schema: {
        description:
          "List indexes in the public schema (table, columns, type, size).",
        tags: ["schema"],
        params: {
          type: "object",
          properties: { database: { type: "string" } },
        },
      },
    },
    asyncHandler(async (req, reply) => {
      const dbName = req.dbName!;
      const cacheKey = server.cache.buildKey(dbName, "indexes");
      const cached = await server.cache.get(cacheKey);
      if (cached) return reply.send(JSON.parse(cached));

      const sql = server.poolManager.getPool(dbName);
      const indexes = await sql`
        SELECT
          i.relname AS name,
          t.relname AS table,
          am.amname AS type,
          pg_catalog.pg_size_pretty(pg_catalog.pg_relation_size(i.oid)) AS size,
          ix.indisunique AS unique,
          ix.indisprimary AS primary,
          COALESCE(
            array_agg(a.attname ORDER BY ord.ordinality)
              FILTER (WHERE a.attname IS NOT NULL),
            ARRAY[]::name[]
          ) AS columns
        FROM pg_catalog.pg_index ix
        JOIN pg_catalog.pg_class i ON i.oid = ix.indexrelid
        JOIN pg_catalog.pg_class t ON t.oid = ix.indrelid
        JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace
        JOIN pg_catalog.pg_am am ON am.oid = i.relam
        LEFT JOIN LATERAL unnest(ix.indkey) WITH ORDINALITY AS ord(attnum, ordinality)
          ON true
        LEFT JOIN pg_catalog.pg_attribute a
          ON a.attrelid = t.oid AND a.attnum = ord.attnum AND a.attnum > 0
        WHERE n.nspname = 'public'
          AND t.relkind IN ('r', 'p', 'm')
        GROUP BY
          i.relname, t.relname, am.amname, i.oid,
          ix.indisunique, ix.indisprimary
        ORDER BY t.relname, i.relname
      `;

      await server.cache.set(cacheKey, JSON.stringify(indexes), TTL.SCHEMA);
      return reply.send(indexes);
    })
  );
}
