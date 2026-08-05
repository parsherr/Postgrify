/**
 * Tablo yönetim route'ları:
 *   GET    /db/:database/tables               — Tabloları listele
 *   POST   /db/:database/tables               — Tablo oluştur
 *   DELETE /db/:database/tables/:table        — Tablo sil
 *   GET    /db/:database/tables/:table/schema — Şemayı getir
 */

import type { FastifyInstance } from "fastify";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { scopeGuard } from "../../middleware/scopeGuard.js";
import { assertIdentifier } from "../../utils/identifier.js";
import { assertColumnType, assertColumnDefault } from "../../utils/ddlSanitizer.js";
import { TTL } from "../../services/cacheService.js";

export async function tablesRoute(server: FastifyInstance) {
  // GET /db/:database/tables
  server.get(
    "/:database/tables",
    {
      preHandler: [scopeGuard("read")],
      schema: {
        description: "List all tables in a database",
        tags: ["tables"],
        params: { type: "object", properties: { database: { type: "string" } } },
      },
    },
    asyncHandler(async (req, reply) => {
      const dbName = req.dbName!;
      const cacheKey = server.cache.buildKey(dbName, "tables");

      const cached = await server.cache.get(cacheKey);
      if (cached) return reply.send(JSON.parse(cached));

      const sql = server.poolManager.getPool(dbName);
      const tables = await sql`
        SELECT
          t.table_name AS name,
          pg_class.reltuples::bigint AS estimated_row_count,
          pg_size_pretty(pg_total_relation_size(pg_class.oid)) AS size
        FROM information_schema.tables t
        JOIN pg_class ON pg_class.relname = t.table_name
          AND pg_class.relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
        WHERE t.table_schema = 'public'
          AND t.table_type = 'BASE TABLE'
        ORDER BY t.table_name
      `;

      const result = { tables };
      await server.cache.set(cacheKey, JSON.stringify(result), TTL.TABLE_LIST);
      return reply.send(result);
    })
  );

  // POST /db/:database/tables
  server.post(
    "/:database/tables",
    {
      preHandler: [scopeGuard("schema")],
      schema: {
        description: "Create a new table",
        tags: ["tables"],
        body: {
          type: "object",
          required: ["name", "columns"],
          properties: {
            name: { type: "string" },
            columns: {
              type: "array",
              items: {
                type: "object",
                required: ["name", "type"],
                properties: {
                  name: { type: "string" },
                  type: { type: "string" },
                  nullable: { type: "boolean", default: true },
                  primaryKey: { type: "boolean", default: false },
                  unique: { type: "boolean", default: false },
                  default: { type: "string" },
                },
              },
            },
          },
        },
      },
    },
    asyncHandler(async (req, reply) => {
      const dbName = req.dbName!;
      const { name, columns } = req.body as {
        name: string;
        columns: Array<{
          name: string;
          type: string;
          nullable?: boolean;
          primaryKey?: boolean;
          unique?: boolean;
          default?: string;
        }>;
      };

      assertIdentifier(name, "table");

      const colDefs = columns.map((col) => {
        assertIdentifier(col.name, "column");
        const safeType = assertColumnType(col.type, col.name);
        const parts: string[] = [`"${col.name}" ${safeType}`];
        if (col.primaryKey) parts.push("PRIMARY KEY");
        if (!col.nullable && !col.primaryKey) parts.push("NOT NULL");
        if (col.unique) parts.push("UNIQUE");
        if (col.default) {
          const safeDefault = assertColumnDefault(col.default, col.name);
          parts.push(`DEFAULT ${safeDefault}`);
        }
        return parts.join(" ");
      });

      const ddl = `CREATE TABLE "${name}" (${colDefs.join(", ")})`;
      const sql = server.poolManager.getPool(dbName);
      await sql.unsafe(ddl);

      // Tablo listesi cache'ini geçersiz kıl
      await server.cache.invalidatePattern(
        server.cache.buildKey(dbName, "tables*")
      );

      return reply.status(201).send({ name, created: true });
    })
  );

  // DELETE /db/:database/tables/:table
  server.delete(
    "/:database/tables/:table",
    {
      preHandler: [scopeGuard("schema")],
      schema: {
        description: "Drop a table",
        tags: ["tables"],
      },
    },
    asyncHandler(async (req, reply) => {
      const dbName = req.dbName!;
      const { table } = req.params as { table: string };

      assertIdentifier(table, "table");

      const sql = server.poolManager.getPool(dbName);
      await sql.unsafe(`DROP TABLE IF EXISTS "${table}"`);

      await server.cache.invalidatePattern(
        server.cache.buildKey(dbName, "*")
      );

      return reply.send({ name: table, dropped: true });
    })
  );

  // GET /db/:database/tables/:table/schema
  server.get(
    "/:database/tables/:table/schema",
    {
      preHandler: [scopeGuard("read")],
      schema: {
        description: "Get table schema (columns, types, constraints)",
        tags: ["tables"],
      },
    },
    asyncHandler(async (req, reply) => {
      const dbName = req.dbName!;
      const { table } = req.params as { table: string };
      assertIdentifier(table, "table");

      const cacheKey = server.cache.buildKey(dbName, "schema", table);
      const cached = await server.cache.get(cacheKey);
      if (cached) return reply.send(JSON.parse(cached));

      const sql = server.poolManager.getPool(dbName);
      const columns = await sql`
        SELECT
          c.column_name AS name,
          c.data_type AS type,
          c.is_nullable AS nullable,
          c.column_default AS default,
          EXISTS (
            SELECT 1 FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu
              ON tc.constraint_name = kcu.constraint_name
            WHERE tc.table_name = c.table_name
              AND kcu.column_name = c.column_name
              AND tc.constraint_type = 'PRIMARY KEY'
          ) AS primary_key
        FROM information_schema.columns c
        WHERE c.table_schema = 'public'
          AND c.table_name = ${table}
        ORDER BY c.ordinal_position
      `;

      const result = { table, columns };
      await server.cache.set(cacheKey, JSON.stringify(result), TTL.SCHEMA);
      return reply.send(result);
    })
  );
}