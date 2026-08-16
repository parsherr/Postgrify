/**
 * Row CRUD route'ları.
 *
 * C-01 (aktif): GET list → PostgREST array + Content-Range + Prefer:count
 * Mutations: legacy body shape korunuyor (sonraki turtle adımlarında Prefer eklenecek)
 *
 *   GET    /db/:database/:table
 *   HEAD   /db/:database/:table   (E-01 — C-01 ile aynı SQL, body yok)
 *   POST   /db/:database/:table
 *   PATCH  /db/:database/:table
 *   DELETE /db/:database/:table
 *   GET    /db/:database/:table/:id
 *   PUT    /db/:database/:table/:id
 *   DELETE /db/:database/:table/:id
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { scopeGuard } from "../../middleware/scopeGuard.js";
import { assertIdentifier } from "../../utils/identifier.js";
import {
  parseWhereConditions,
  parseSelectColumns,
  parseOrderBy,
} from "../../services/queryBuilder.js";
import { TTL } from "../../services/cacheService.js";
import { parsePrefer } from "../../utils/prefer.js";
import { setContentRange } from "../../utils/contentRange.js";
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

function resolvePkColumn(pk: string | undefined): string {
  const col = pk ?? "id";
  assertIdentifier(col, "pk");
  return col;
}

async function resolveCount(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: { unsafe: (sql: string, params?: any[]) => Promise<any[]> },
  table: string,
  whereSql: string,
  whereValues: unknown[],
  mode: "exact" | "planned" | "estimated" | null
): Promise<number | null> {
  if (!mode) return null;

  if (mode === "exact") {
    const countSql = `SELECT count(*)::bigint AS total FROM "${table}" ${whereSql}`;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [row] = await tx.unsafe(countSql, whereValues as any[]);
    return Number(row.total);
  }

  if (mode === "planned") {
    const explainSql = `EXPLAIN (FORMAT JSON) SELECT 1 FROM "${table}" ${whereSql}`;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [plan] = await tx.unsafe(explainSql, whereValues as any[]);
    const planJson = plan?.["QUERY PLAN"] ?? plan;
    const root = Array.isArray(planJson) ? planJson[0] : planJson;
    const rows = root?.Plan?.["Plan Rows"] ?? root?.plan?.["Plan Rows"];
    return typeof rows === "number" ? rows : null;
  }

  // estimated — table stats (filter ignored; fast path like PostgREST)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [stat] = await tx.unsafe(
    `SELECT GREATEST(reltuples::bigint, 0) AS total FROM pg_class WHERE relname = $1 LIMIT 1`,
    [table] as any[]
  );
  return stat ? Number(stat.total) : null;
}

/**
 * C-01 + E-01 shared list handler.
 */
async function handleGetList(
  server: FastifyInstance,
  req: FastifyRequest,
  reply: FastifyReply,
  headOnly: boolean
) {
  const dbName = req.dbName!;
  const { table } = req.params as { table: string };
  assertIdentifier(table, "table");

  const query = req.query as {
    select?: string;
    where?: string | string[];
    or?: string | string[];
    order?: string;
    sort?: string;
    limit?: number;
    offset?: number;
  };

  const prefer = parsePrefer(req.headers.prefer);

  const whereList = Array.isArray(query.where)
    ? query.where
    : query.where
      ? [query.where]
      : [];

  const orRaw = Array.isArray(query.or)
    ? query.or
    : query.or
      ? [query.or]
      : [];
  const orList = orRaw.flatMap((s) =>
    s.split(",").map((c) => c.trim()).filter(Boolean)
  );

  let cols: string;
  let whereSql: string;
  let whereValues: unknown[];
  let orderSql: string;

  try {
    cols = parseSelectColumns(query.select);
    const parsed = parseWhereConditions(whereList, orList);
    whereSql = parsed.sql;
    whereValues = parsed.values;
    orderSql = parseOrderBy(query.order, query.sort);
  } catch (e) {
    return reply.status(400).send({
      error: "Invalid query parameters",
      message: e instanceof Error ? e.message : String(e),
    });
  }

  const limit = Math.min(query.limit ?? 100, 1000);
  const offset = query.offset ?? 0;

  // E-01: HEAD + limit=0 → skip row SELECT (PostgREST optimization); COUNT if Prefer:count
  const skipRowFetch = headOnly && limit === 0;

  const cacheKey = queryCacheKey(server.cache, dbName, table, {
    ...query,
    count: prefer.count,
  });

  if (!headOnly) {
    const cached = await server.cache.get(cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached) as {
        rows: unknown[];
        total: number | null;
        limit: number;
        offset: number;
      };
      setContentRange(reply, parsed.offset, parsed.rows.length, parsed.total);
      return reply.send(parsed.rows);
    }
  }

  const sql = server.poolManager.getPool(dbName);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { rows, total } = await sql.begin("read only", async (tx: any) => {
    let rows: unknown[] = [];
    if (!skipRowFetch) {
      const fullSql = `
        SELECT ${cols} FROM "${table}"
        ${whereSql}
        ${orderSql}
        LIMIT $${whereValues.length + 1}
        OFFSET $${whereValues.length + 2}
      `;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      rows = await tx.unsafe(fullSql, [...whereValues, limit, offset] as any[]);
    }
    const total = await resolveCount(tx, table, whereSql, whereValues, prefer.count);
    return { rows, total };
  });

  setContentRange(reply, offset, rows.length, total, {
    emptyStar: skipRowFetch,
  });

  if (!headOnly) {
    await server.cache.set(
      cacheKey,
      JSON.stringify({ rows, total, limit, offset }),
      TTL.ROW_QUERY
    );
  }

  // Body is the array (C-01). HEAD (E-01): empty body — RFC 9110.
  if (headOnly) return reply.status(200).send();
  return reply.send(rows);
}

export async function rowsRoute(server: FastifyInstance) {
  // ── C-01 GET list ─────────────────────────────────────────────────────────
  server.get(
    "/:database/:table",
    {
      preHandler: [server.authenticateAny, scopeGuard("read")],
      schema: {
        description:
          "List rows. Body is a JSON array. Pagination via Content-Range; " +
          "Prefer: count=exact|planned|estimated for totals.",
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
            order: {
              type: "string",
              description:
                'Sort: "column.asc" / "column.desc" / "col.asc.nullsfirst", ' +
                'or direction when ?sort=column is also provided.',
            },
            sort: {
              type: "string",
              description: "Column to sort by when using ?sort=col&order=dir",
            },
            limit: { type: "integer", default: 100, minimum: 0, maximum: 1000 },
            offset: { type: "integer", default: 0, minimum: 0 },
          },
        },
      },
    },
    asyncHandler(async (req, reply) => handleGetList(server, req, reply, false))
  );

  // ── E-01 HEAD (same as GET, no body) ──────────────────────────────────────
  server.head(
    "/:database/:table",
    {
      preHandler: [server.authenticateAny, scopeGuard("read")],
      schema: {
        description:
          "HEAD list — Content-Range without body. Use limit=0 + Prefer:count=exact " +
          "to count without fetching rows (PostgREST optimization).",
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
            },
            order: { type: "string" },
            sort: { type: "string" },
            limit: { type: "integer", default: 100, minimum: 0, maximum: 1000 },
            offset: { type: "integer", default: 0, minimum: 0 },
          },
        },
      },
    },
    asyncHandler(async (req, reply) => handleGetList(server, req, reply, true))
  );

  // ── POST — legacy (C-02 sonraki adım) ─────────────────────────────────────
  server.post(
    "/:database/:table",
    {
      preHandler: [server.authenticateAny, scopeGuard("write")],
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

  // ── PATCH — legacy (C-03 sonraki adım) ────────────────────────────────────
  server.patch(
    "/:database/:table",
    {
      preHandler: [server.authenticateAny, scopeGuard("write")],
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
          error:
            "where filter required for batch update to prevent accidental full-table update",
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
      const updated = await sql.unsafe(updateSql, [
        ...whereValues,
        ...Object.values(updates),
      ] as any[]);

      await server.cache.invalidatePattern(
        server.cache.buildKey(dbName, "rows", table, "*")
      );

      return reply.send({ updated });
    })
  );

  // ── DELETE batch — legacy (C-04 sonraki adım) ─────────────────────────────
  server.delete(
    "/:database/:table",
    {
      preHandler: [server.authenticateAny, scopeGuard("delete")],
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
      const deleted = await sql.unsafe(
        `DELETE FROM "${table}" ${whereSql} RETURNING *`,
        whereValues as any[]
      );

      await server.cache.invalidatePattern(
        server.cache.buildKey(dbName, "rows", table, "*")
      );

      return reply.send({ deleted });
    })
  );

  // GET /:id — legacy (C-06 sonraki adım: select=)
  server.get(
    "/:database/:table/:id",
    {
      preHandler: [server.authenticateAny, scopeGuard("read")],
      schema: {
        description:
          "Get a single row by primary key. Use ?pk=column to specify a non-id primary key column.",
        tags: ["rows"],
        querystring: {
          type: "object",
          properties: {
            pk: {
              type: "string",
              description: "Primary key column name (default: id)",
            },
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

  // PUT /:id — legacy (C-05 sonraki adım)
  server.put(
    "/:database/:table/:id",
    {
      preHandler: [server.authenticateAny, scopeGuard("write")],
      schema: {
        description:
          "Replace a row by primary key. Use ?pk=column to specify a non-id primary key column.",
        tags: ["rows"],
        querystring: {
          type: "object",
          properties: {
            pk: {
              type: "string",
              description: "Primary key column name (default: id)",
            },
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

  // DELETE /:id — legacy
  server.delete(
    "/:database/:table/:id",
    {
      preHandler: [server.authenticateAny, scopeGuard("delete")],
      schema: {
        description:
          "Delete a single row by primary key. Use ?pk=column to specify a non-id primary key column.",
        tags: ["rows"],
        querystring: {
          type: "object",
          properties: {
            pk: {
              type: "string",
              description: "Primary key column name (default: id)",
            },
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
