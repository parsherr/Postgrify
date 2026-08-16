/**
 * Row CRUD route'ları.
 *
 * C-01 (aktif): GET list → PostgREST array + Content-Range + Prefer:count
 * Mutations: legacy body shape korunuyor (sonraki turtle adımlarında Prefer eklenecek)
 *
 *   GET    /db/:database/:table
 *   HEAD   /db/:database/:table   (E-01)
 *   OPTIONS /db/:database/:table  (E-02 — Allow, no DB)
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
  parseSelect,
  attachEmbedSql,
  parseOrderBy,
} from "../../services/queryBuilder.js";
import { buildEmbedSelectFragments } from "../../services/queryEmbedSql.js";
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
  let groupBySql: string;
  let whereSql: string;
  let whereValues: unknown[];
  let orderSql: string;
  let embedSpecs = [] as import("../../services/queryEmbed.js").EmbedSpec[];

  try {
    const selectParsed = parseSelect(query.select);
    cols = selectParsed.sql;
    groupBySql = selectParsed.groupBySql;
    embedSpecs = selectParsed.embeds;
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

  if (embedSpecs.length > 0) {
    try {
      const fragments = await buildEmbedSelectFragments(
        sql,
        dbName,
        table,
        embedSpecs
      );
      const attached = attachEmbedSql(
        { sql: cols, groupBySql, hasAggregate: false, embeds: embedSpecs },
        fragments
      );
      cols = attached.sql;
    } catch (e) {
      return reply.status(400).send({
        error: "Invalid embed",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { rows, total } = await sql.begin("read only", async (tx: any) => {
    let rows: unknown[] = [];
    if (!skipRowFetch) {
      const fullSql = `
        SELECT ${cols} FROM "${table}"
        ${whereSql}
        ${groupBySql}
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

  // ── E-02 OPTIONS (Allow + CORS methods; no DB hit) ────────────────────────
  const TABLE_ALLOW = "GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS";
  server.options(
    "/:database/:table",
    {
      // CORS preflight often has no Bearer — skip scope; still resolve via parent hooks.
      // Parent authenticateAny would 401; override with no-op auth for OPTIONS only.
      preHandler: [],
      schema: {
        description: "Supported HTTP methods for table resource (PostgREST-style Allow)",
        tags: ["rows"],
        security: [],
      },
    },
    asyncHandler(async (req, reply) => {
      const { table } = req.params as { table: string };
      try {
        assertIdentifier(table, "table");
      } catch (e) {
        return reply.status(400).send({
          error: "Invalid table name",
          message: e instanceof Error ? e.message : String(e),
        });
      }
      reply.header("Allow", TABLE_ALLOW);
      reply.header("Access-Control-Allow-Methods", TABLE_ALLOW);
      reply.header(
        "Access-Control-Allow-Headers",
        "Authorization, Content-Type, Prefer, X-Database, X-API-Key, Range, Range-Unit"
      );
      return reply.status(200).send();
    })
  );

  // ── C-02 POST insert / upsert (Prefer: return / resolution / missing) ─────
  server.post(
    "/:database/:table",
    {
      preHandler: [server.authenticateAny, scopeGuard("write")],
      schema: {
        description:
          "Insert rows. Prefer: return=minimal|representation|headers-only; " +
          "resolution=merge-duplicates|ignore-duplicates with ?on_conflict=; " +
          "missing=default|null; ?columns= whitelist.",
        tags: ["rows"],
        querystring: {
          type: "object",
          properties: {
            on_conflict: {
              type: "string",
              description: "Comma-separated UNIQUE columns for ON CONFLICT",
            },
            columns: {
              type: "string",
              description: "Comma-separated column whitelist (bulk / missing=default)",
            },
          },
        },
      },
    },
    asyncHandler(async (req, reply) => {
      const dbName = req.dbName!;
      const { table } = req.params as { table: string };
      assertIdentifier(table, "table");

      const prefer = parsePrefer(req.headers.prefer);
      const q = req.query as { on_conflict?: string; columns?: string };

      if (prefer.resolution && !q.on_conflict) {
        return reply.status(400).send({
          error: "on_conflict query param required when Prefer: resolution is set",
        });
      }

      const body = req.body as Record<string, unknown> | Record<string, unknown>[] | null;
      if (body === null || body === undefined) {
        return reply.status(400).send({ error: "Empty body" });
      }
      let rowsIn = Array.isArray(body) ? body : [body];
      if (rowsIn.length === 0) {
        return reply.status(400).send({ error: "Empty body" });
      }

      // columns= whitelist
      let allowed: string[] | null = null;
      if (q.columns) {
        allowed = q.columns.split(",").map((c) => c.trim()).filter(Boolean);
        for (const c of allowed) assertIdentifier(c, "column");
      }

      const rows: Record<string, unknown>[] = [];
      for (const row of rowsIn) {
        if (typeof row !== "object" || row === null || Array.isArray(row)) {
          return reply.status(400).send({ error: "Each row must be a JSON object" });
        }
        const src = row as Record<string, unknown>;
        const out: Record<string, unknown> = {};
        const keys = allowed ?? Object.keys(src);
        for (const k of keys) {
          assertIdentifier(k, "column");
          if (k in src) {
            out[k] = src[k];
          } else if (prefer.missing === "null") {
            out[k] = null;
          }
        }
        rows.push(out);
      }

      // Union of keys across rows (for multi-row INSERT column list)
      const allKeys = [...new Set(rows.flatMap((r) => Object.keys(r)))];
      if (allKeys.length === 0) {
        return reply.status(400).send({
          error: "No columns to insert (check body and Prefer: missing / columns=)",
        });
      }
      for (const k of allKeys) assertIdentifier(k, "column");

      let preferenceApplied: string[] = [];

      let conflictSql = "";
      if (prefer.resolution && q.on_conflict) {
        const conflictCols = q.on_conflict.split(",").map((c) => c.trim()).filter(Boolean);
        for (const c of conflictCols) assertIdentifier(c, "on_conflict");
        const target = conflictCols.map((c) => `"${c}"`).join(", ");
        if (prefer.resolution === "ignore-duplicates") {
          conflictSql = ` ON CONFLICT (${target}) DO NOTHING`;
        } else {
          const updates = allKeys
            .filter((k) => !conflictCols.includes(k))
            .map((k) => `"${k}" = EXCLUDED."${k}"`)
            .join(", ");
          conflictSql = updates
            ? ` ON CONFLICT (${target}) DO UPDATE SET ${updates}`
            : ` ON CONFLICT (${target}) DO NOTHING`;
        }
        preferenceApplied.push(`resolution=${prefer.resolution}`);
      }

      const wantsReturning =
        prefer.return === "representation" || prefer.return === "headers-only";
      const returning = wantsReturning ? " RETURNING *" : "";

      const colList = allKeys.map((k) => `"${k}"`).join(", ");
      const values: unknown[] = [];
      const rowPlaceholders = rows.map((row) => {
        const ph = allKeys.map((k) => {
          values.push(k in row ? row[k] : null);
          return `$${values.length}`;
        });
        return `(${ph.join(", ")})`;
      });

      const insertSql =
        `INSERT INTO "${table}" (${colList}) VALUES ${rowPlaceholders.join(", ")}` +
        conflictSql +
        returning;

      const sql = server.poolManager.getPool(dbName);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await sql.unsafe(insertSql, values as any[]);
      const inserted = wantsReturning
        ? (result as Record<string, unknown>[])
        : [];

      await server.cache.invalidatePattern(
        server.cache.buildKey(dbName, "rows", table, "*")
      );

      // Upsert that may update existing rows → 200; pure insert → 201
      const status = prefer.resolution ? 200 : 201;

      if (prefer.return === "headers-only") {
        const first = inserted[0];
        if (first) {
          const idVal = first.id ?? Object.values(first)[0];
          reply.header("Location", `/db/${dbName}/${table}?id=eq.${idVal}`);
        }
        preferenceApplied.push("return=headers-only");
        reply.header("Preference-Applied", preferenceApplied.join(", "));
        return reply.status(status).send();
      }

      if (prefer.return === "representation") {
        preferenceApplied.push("return=representation");
        reply.header("Preference-Applied", preferenceApplied.join(", "));
        return reply.status(status).send(inserted);
      }

      // minimal (default) — no body
      preferenceApplied.push("return=minimal");
      reply.header("Preference-Applied", preferenceApplied.join(", "));
      return reply.status(status).send();
    })
  );

  // ── C-03 PATCH batch (Prefer: return; where required — ADR-009) ───────────
  server.patch(
    "/:database/:table",
    {
      preHandler: [server.authenticateAny, scopeGuard("write")],
      schema: {
        description:
          "Update rows matching where filter (required). Prefer: return=minimal|representation. " +
          "X-Postgrify-Require-Filter: true",
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
      const prefer = parsePrefer(req.headers.prefer);
      reply.header("X-Postgrify-Require-Filter", "true");

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
      if (!updates || typeof updates !== "object" || Array.isArray(updates)) {
        return reply.status(400).send({ error: "Update body must be a JSON object" });
      }
      const keys = Object.keys(updates);
      if (keys.length === 0) {
        return reply.status(400).send({ error: "Empty update body" });
      }

      const { sql: whereSql, values: whereValues } = parseWhereConditions(whereList);

      const setCols = keys
        .map((k, i) => {
          assertIdentifier(k, "column");
          return `"${k}" = $${whereValues.length + i + 1}`;
        })
        .join(", ");

      const returning =
        prefer.return === "representation" ? " RETURNING *" : "";
      const updateSql = `UPDATE "${table}" SET ${setCols} ${whereSql}${returning}`;

      const sql = server.poolManager.getPool(dbName);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const updated = await sql.unsafe(updateSql, [
        ...whereValues,
        ...Object.values(updates),
      ] as any[]);

      await server.cache.invalidatePattern(
        server.cache.buildKey(dbName, "rows", table, "*")
      );

      if (prefer.return === "representation") {
        reply.header("Preference-Applied", "return=representation");
        return reply.status(200).send(updated);
      }

      reply.header("Preference-Applied", "return=minimal");
      return reply.status(204).send();
    })
  );

  // ── C-04 DELETE batch (Prefer: return; where required — ADR-009) ──────────
  server.delete(
    "/:database/:table",
    {
      preHandler: [server.authenticateAny, scopeGuard("delete")],
      schema: {
        description:
          "Delete rows matching where filter (required). Prefer: return=minimal|representation.",
        tags: ["rows"],
      },
    },
    asyncHandler(async (req, reply) => {
      const dbName = req.dbName!;
      const { table } = req.params as { table: string };
      assertIdentifier(table, "table");
      const prefer = parsePrefer(req.headers.prefer);
      reply.header("X-Postgrify-Require-Filter", "true");

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
      const returning = prefer.return === "representation" ? " RETURNING *" : "";

      const sql = server.poolManager.getPool(dbName);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const deleted = await sql.unsafe(
        `DELETE FROM "${table}" ${whereSql}${returning}`,
        whereValues as any[]
      );

      await server.cache.invalidatePattern(
        server.cache.buildKey(dbName, "rows", table, "*")
      );

      if (prefer.return === "representation") {
        reply.header("Preference-Applied", "return=representation");
        return reply.status(200).send(deleted);
      }

      reply.header("Preference-Applied", "return=minimal");
      return reply.status(204).send();
    })
  );

  // ── C-06 GET /:id (?select= + ?pk=) — object body (Postgrify DX) ─────────
  server.get(
    "/:database/:table/:id",
    {
      preHandler: [server.authenticateAny, scopeGuard("read")],
      schema: {
        description:
          "Get a single row by primary key (object, not array). ?pk= and ?select= supported.",
        tags: ["rows"],
        querystring: {
          type: "object",
          properties: {
            pk: {
              type: "string",
              description: "Primary key column name (default: id)",
            },
            select: {
              type: "string",
              description: "Comma-separated columns (default *)",
            },
          },
        },
      },
    },
    asyncHandler(async (req, reply) => {
      const dbName = req.dbName!;
      const { table, id } = req.params as { table: string; id: string };
      const { pk, select } = req.query as { pk?: string; select?: string };
      assertIdentifier(table, "table");
      const pkCol = resolvePkColumn(pk);

      let cols: string;
      let groupBySql: string;
      try {
        let parsed = parseSelect(select);
        cols = parsed.sql;
        groupBySql = parsed.groupBySql;
        const pool = server.poolManager.getPool(dbName);
        if (parsed.embeds.length > 0) {
          const fragments = await buildEmbedSelectFragments(
            pool,
            dbName,
            table,
            parsed.embeds
          );
          parsed = attachEmbedSql(parsed, fragments);
          cols = parsed.sql;
        }
      } catch (e) {
        return reply.status(400).send({
          error: "Invalid select",
          message: e instanceof Error ? e.message : String(e),
        });
      }

      const sql = server.poolManager.getPool(dbName);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const [row] = await sql.unsafe(
        `SELECT ${cols} FROM "${table}" WHERE "${pkCol}" = $1 ${groupBySql} LIMIT 1`,
        [id] as any[]
      );

      if (!row) return reply.status(404).send({ error: "Row not found" });
      return reply.send(row);
    })
  );

  // ── C-05 PUT /:id — upsert + Prefer: return (ADR-006) ─────────────────────
  server.put(
    "/:database/:table/:id",
    {
      preHandler: [server.authenticateAny, scopeGuard("write")],
      schema: {
        description:
          "Update row by PK; if missing, INSERT (upsert). Prefer: return=minimal|representation|headers-only.",
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
      const preferHeader = req.headers.prefer;
      const prefer = parsePrefer(preferHeader);
      // Prefer yoksa representation (GUI geriye uyum); açık Prefer honor edilir
      const returnMode =
        preferHeader === undefined || preferHeader === ""
          ? "representation"
          : prefer.return;

      const updates = req.body as Record<string, unknown>;
      if (!updates || typeof updates !== "object" || Array.isArray(updates)) {
        return reply.status(400).send({ error: "Body must be a JSON object" });
      }
      const keys = Object.keys(updates);
      for (const k of keys) assertIdentifier(k, "column");

      const sql = server.poolManager.getPool(dbName);
      const returningClause =
        returnMode === "minimal" ? "" : " RETURNING *";

      let created = false;
      let row: Record<string, unknown> | undefined;

      if (keys.length > 0) {
        const setCols = keys
          .map((k, i) => `"${k}" = $${i + 2}`)
          .join(", ");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const updatedRows = (await sql.unsafe(
          `UPDATE "${table}" SET ${setCols} WHERE "${pkCol}" = $1${returningClause || " RETURNING *"}`,
          [id, ...Object.values(updates)] as any[]
        )) as Record<string, unknown>[];
        row = updatedRows[0];
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const existing = (await sql.unsafe(
          `SELECT * FROM "${table}" WHERE "${pkCol}" = $1 LIMIT 1`,
          [id] as any[]
        )) as Record<string, unknown>[];
        row = existing[0];
      }

      if (!row) {
        const insertRow: Record<string, unknown> = { ...updates };
        const numericId = Number(id);
        insertRow[pkCol] = Number.isNaN(numericId) ? id : numericId;
        const cols = Object.keys(insertRow);
        for (const c of cols) assertIdentifier(c, "column");
        const colSql = cols.map((c) => `"${c}"`).join(", ");
        const ph = cols.map((_, i) => `$${i + 1}`).join(", ");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const inserted = (await sql.unsafe(
          `INSERT INTO "${table}" (${colSql}) VALUES (${ph}) RETURNING *`,
          Object.values(insertRow) as any[]
        )) as Record<string, unknown>[];
        row = inserted[0];
        created = true;
      }

      await server.cache.invalidatePattern(
        server.cache.buildKey(dbName, "rows", table, "*")
      );

      if (returnMode === "minimal") {
        return reply.status(created ? 201 : 204).send();
      }
      if (returnMode === "headers-only") {
        reply.header("Location", `/db/${dbName}/${table}/${id}`);
        return reply.status(created ? 201 : 200).send();
      }
      reply.header("Preference-Applied", `return=${returnMode}`);
      return reply.status(created ? 201 : 200).send(row);
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
