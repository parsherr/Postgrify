/**
 * Row CRUD route'ları:
 *   GET    /db/:database/:table          — Satır listele (filtre, sıralama, sayfalama)
 *   POST   /db/:database/:table          — Satır ekle (tekil veya dizi)
 *   PATCH  /db/:database/:table          — Toplu güncelle
 *   DELETE /db/:database/:table          — Toplu sil
 *   GET    /db/:database/:table/:id      — Tekil satır (?pk=kolon ile PK kolonu seçilebilir)
 *   PUT    /db/:database/:table/:id      — Satır güncelle (?pk=kolon ile PK kolonu seçilebilir)
 *   DELETE /db/:database/:table/:id      — Satır sil (?pk=kolon ile PK kolonu seçilebilir)
 */

import type { FastifyInstance } from "fastify";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { scopeGuard } from "../../middleware/scopeGuard.js";
import { assertIdentifier } from "../../utils/identifier.js";
import {
  parseWhereConditions,
  parseSelectColumns,
  parseOrderBy,
} from "../../services/queryBuilder.js";
import { TTL } from "../../services/cacheService.js";
import crypto from "node:crypto";

function queryCacheKey(
  cache: { buildKey: (...p: string[]) => string },
  dbName: string,
  table: string,
  params: Record<string, unknown>
): string {
  const hash = crypto
    .createHash("sha1")
    .update(JSON.stringify(params))
    .digest("hex")
    .slice(0, 10);
  return cache.buildKey(dbName, "rows", table, hash);
}

/**
 * ?pk= query parametresinden primary key kolon adını okur.
 * Belirtilmezse "id" döner. Geçersiz identifier ise hata fırlatır.
 */
function resolvePkColumn(pk: string | undefined): string {
  const col = pk ?? "id";
  assertIdentifier(col, "pk");
  return col;
}

export async function rowsRoute(server: FastifyInstance) {
  // GET /db/:database/:table
  server.get(
    "/:database/:table",
    {
      preHandler: [scopeGuard("read")],
      schema: {
        description: "List rows with optional filtering, sorting and pagination",
        tags: ["rows"],
        querystring: {
          type: "object",
          properties: {
            select: { type: "string" },
            where: { type: "array", items: { type: "string" } },
            or: {
              oneOf: [
                { type: "string" },
                { type: "array", items: { type: "string" } },
              ],
              description: "OR-grouped conditions: role.eq.admin,role.eq.mod",
            },
            order: { type: "string" },
            limit: { type: "integer", default: 100, maximum: 1000 },
            offset: { type: "integer", default: 0 },
          },
        },
      },
    },
    asyncHandler(async (req, reply) => {
      const dbName = req.dbName!;
      const { table } = req.params as { table: string };
      assertIdentifier(table, "table");

      const query = req.query as {
        select?: string;
        where?: string | string[];
        or?: string | string[];
        order?: string;
        limit?: number;
        offset?: number;
      };

      const whereList = Array.isArray(query.where)
        ? query.where
        : query.where
        ? [query.where]
        : [];

      // ?or=role.eq.admin,role.eq.mod → ["role.eq.admin", "role.eq.mod"]
      // ya da ?or=role.eq.admin&or=role.eq.mod → ["role.eq.admin", "role.eq.mod"]
      const orRaw = Array.isArray(query.or)
        ? query.or
        : query.or
        ? [query.or]
        : [];
      const orList = orRaw.flatMap((s) => s.split(",").map((c) => c.trim()).filter(Boolean));

      const cacheKey = queryCacheKey(server.cache, dbName, table, { ...query });
      const cached = await server.cache.get(cacheKey);
      if (cached) return reply.send(JSON.parse(cached));

      const cols = parseSelectColumns(query.select);
      const { sql: whereSql, values: whereValues } = parseWhereConditions(whereList, orList);
      const orderSql = parseOrderBy(query.order);
      const limit = Math.min(query.limit ?? 100, 1000);
      const offset = query.offset ?? 0;

      const sql = server.poolManager.getPool(dbName);
      const fullSql = `
        SELECT ${cols} FROM "${table}"
        ${whereSql}
        ${orderSql}
        LIMIT $${whereValues.length + 1}
        OFFSET $${whereValues.length + 2}
      `;
      const countSql = `SELECT count(*) AS total FROM "${table}" ${whereSql}`;

      // Rows + count aynı read-only transaction içinde — tutarlı snapshot garantisi
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { rows, countResult } = await sql.begin("read only", async (tx) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rows = await tx.unsafe(fullSql, [...whereValues, limit, offset] as any[]);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const [countResult] = await tx.unsafe(countSql, whereValues as any[]);
        return { rows, countResult };
      });

      const result = {
        rows,
        total: Number(countResult.total),
        limit,
        offset,
      };

      await server.cache.set(cacheKey, JSON.stringify(result), TTL.ROW_QUERY);
      return reply.send(result);
    })
  );

  // POST /db/:database/:table — satır ekle
  server.post(
    "/:database/:table",
    {
      preHandler: [scopeGuard("write")],
      schema: {
        description: "Insert one or multiple rows",
        tags: ["rows"],
      },
    },
    asyncHandler(async (req, reply) => {
      const dbName = req.dbName!;
      const { table } = req.params as { table: string };
      assertIdentifier(table, "table");

      const body = req.body as Record<string, unknown> | Record<string, unknown>[];
      const rows = Array.isArray(body) ? body : [body];

      const sql = server.poolManager.getPool(dbName);
      const inserted = await sql`INSERT INTO ${sql(table)} ${sql(rows)} RETURNING *`;

      await server.cache.invalidatePattern(
        server.cache.buildKey(dbName, "rows", table, "*")
      );

      return reply.status(201).send({ inserted });
    })
  );

  // PATCH /db/:database/:table — toplu güncelle
  server.patch(
    "/:database/:table",
    {
      preHandler: [scopeGuard("write")],
      schema: {
        description: "Update rows matching the where filter",
        tags: ["rows"],
        querystring: {
          type: "object",
          properties: {
            where: { type: "array", items: { type: "string" } },
          },
        },
      },
    },
    asyncHandler(async (req, reply) => {
      const dbName = req.dbName!;
      const { table } = req.params as { table: string };
      assertIdentifier(table, "table");

      const query = req.query as { where?: string | string[] };
      const whereList = Array.isArray(query.where)
        ? query.where
        : query.where
        ? [query.where]
        : [];

      if (whereList.length === 0) {
        return reply.status(400).send({
          error: "where filter required for batch update to prevent accidental full-table update",
        });
      }

      const updates = req.body as Record<string, unknown>;
      const { sql: whereSql, values: whereValues } = parseWhereConditions(whereList);

      const sql = server.poolManager.getPool(dbName);
      const setCols = Object.keys(updates)
        .map((k, i) => {
          assertIdentifier(k, "column");
          return `"${k}" = $${whereValues.length + i + 1}`;
        })
        .join(", ");

      const updateSql = `
        UPDATE "${table}" SET ${setCols} ${whereSql} RETURNING *
      `;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const updated = await sql.unsafe(updateSql, [...whereValues, ...Object.values(updates)] as any[]);

      await server.cache.invalidatePattern(
        server.cache.buildKey(dbName, "rows", table, "*")
      );

      return reply.send({ updated });
    })
  );

  // DELETE /db/:database/:table — toplu sil
  server.delete(
    "/:database/:table",
    {
      preHandler: [scopeGuard("delete")],
      schema: {
        description: "Delete rows matching the where filter",
        tags: ["rows"],
      },
    },
    asyncHandler(async (req, reply) => {
      const dbName = req.dbName!;
      const { table } = req.params as { table: string };
      assertIdentifier(table, "table");

      const query = req.query as { where?: string | string[] };
      const whereList = Array.isArray(query.where)
        ? query.where
        : query.where
        ? [query.where]
        : [];

      if (whereList.length === 0) {
        return reply.status(400).send({
          error: "where filter required for batch delete",
        });
      }

      const { sql: whereSql, values: whereValues } = parseWhereConditions(whereList);

      const sql = server.poolManager.getPool(dbName);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const deleted = await sql.unsafe(`DELETE FROM "${table}" ${whereSql} RETURNING *`, whereValues as any[]);

      await server.cache.invalidatePattern(
        server.cache.buildKey(dbName, "rows", table, "*")
      );

      return reply.send({ deleted });
    })
  );

  // GET /db/:database/:table/:id
  server.get(
    "/:database/:table/:id",
    {
      preHandler: [scopeGuard("read")],
      schema: {
        description: "Get a single row by primary key. Use ?pk=column to specify a non-id primary key column.",
        tags: ["rows"],
        querystring: {
          type: "object",
          properties: {
            pk: { type: "string", description: "Primary key column name (default: id)" },
          },
        },
      },
    },
    asyncHandler(async (req, reply) => {
      const dbName = req.dbName!;
      const { table, id } = req.params as { table: string; id: string };
      const { pk } = req.query as { pk?: string };
      assertIdentifier(table, "table");
      const pkCol = resolvePkColumn(pk);

      const sql = server.poolManager.getPool(dbName);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const [row] = await sql.unsafe(
        `SELECT * FROM "${table}" WHERE "${pkCol}" = $1 LIMIT 1`,
        [id] as any[]
      );

      if (!row) return reply.status(404).send({ error: "Row not found" });
      return reply.send(row);
    })
  );

  // PUT /db/:database/:table/:id
  server.put(
    "/:database/:table/:id",
    {
      preHandler: [scopeGuard("write")],
      schema: {
        description: "Replace a row by primary key. Use ?pk=column to specify a non-id primary key column.",
        tags: ["rows"],
        querystring: {
          type: "object",
          properties: {
            pk: { type: "string", description: "Primary key column name (default: id)" },
          },
        },
      },
    },
    asyncHandler(async (req, reply) => {
      const dbName = req.dbName!;
      const { table, id } = req.params as { table: string; id: string };
      const { pk } = req.query as { pk?: string };
      assertIdentifier(table, "table");
      const pkCol = resolvePkColumn(pk);

      const updates = req.body as Record<string, unknown>;
      const sql = server.poolManager.getPool(dbName);

      const setCols = Object.keys(updates)
        .map((k, i) => {
          assertIdentifier(k, "column");
          return `"${k}" = $${i + 2}`;
        })
        .join(", ");

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const [updated] = await sql.unsafe(
        `UPDATE "${table}" SET ${setCols} WHERE "${pkCol}" = $1 RETURNING *`,
        [id, ...Object.values(updates)] as any[]
      );

      if (!updated) return reply.status(404).send({ error: "Row not found" });

      await server.cache.invalidatePattern(
        server.cache.buildKey(dbName, "rows", table, "*")
      );

      return reply.send(updated);
    })
  );

  // DELETE /db/:database/:table/:id
  server.delete(
    "/:database/:table/:id",
    {
      preHandler: [scopeGuard("delete")],
      schema: {
        description: "Delete a single row by primary key. Use ?pk=column to specify a non-id primary key column.",
        tags: ["rows"],
        querystring: {
          type: "object",
          properties: {
            pk: { type: "string", description: "Primary key column name (default: id)" },
          },
        },
      },
    },
    asyncHandler(async (req, reply) => {
      const dbName = req.dbName!;
      const { table, id } = req.params as { table: string; id: string };
      const { pk } = req.query as { pk?: string };
      assertIdentifier(table, "table");
      const pkCol = resolvePkColumn(pk);

      const sql = server.poolManager.getPool(dbName);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const [deleted] = await sql.unsafe(
        `DELETE FROM "${table}" WHERE "${pkCol}" = $1 RETURNING *`,
        [id] as any[]
      );

      if (!deleted) return reply.status(404).send({ error: "Row not found" });

      await server.cache.invalidatePattern(
        server.cache.buildKey(dbName, "rows", table, "*")
      );

      return reply.send(deleted);
    })
  );
}