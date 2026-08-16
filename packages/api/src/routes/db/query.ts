/**
 * POST /db/:database/query — Ham SQL çalıştırma.
 * POST /db/:database/query/explain — E-87 EXPLAIN (FORMAT JSON) plan.
 *
 * Varsayılan mod: yalnızca SELECT ifadeleri izin verilir.
 * Admin token veya "query" scope ile tam SQL (admin ayarına bağlı).
 *
 * Güvenlik:
 *   - SELECT dışındaki keyword'ler blocklist ile engellenir (varsayılan)
 *   - Parametrik sorgular desteklenir: { sql, params: [] }
 */

import type { FastifyInstance } from "fastify";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { scopeGuard } from "../../middleware/scopeGuard.js";
import { config } from "../../config/env.js";
import { insertAuditLog } from "./auth/provision.js";

const BLOCKED_KEYWORDS =
  /\b(DROP|TRUNCATE|DELETE|UPDATE|INSERT|ALTER|CREATE|GRANT|REVOKE|EXECUTE|COPY)\b/i;

// WITH ... (INSERT|UPDATE|DELETE|...) SELECT şeklindeki writeable CTE'leri yakalar
const WRITABLE_CTE_PATTERN =
  /\bWITH\b[\s\S]*?\b(INSERT|UPDATE|DELETE|TRUNCATE|DROP|ALTER|CREATE)\b/i;

function assertSelectOnlySql(
  rawSql: string,
  isAdmin: boolean,
  adminFullSqlEnabled: boolean
): { ok: true } | { ok: false; status: number; error: string; message?: string } {
  if (isAdmin && adminFullSqlEnabled) return { ok: true };

  const trimmed = rawSql.trim().toUpperCase();
  if (!trimmed.startsWith("SELECT") && !trimmed.startsWith("WITH")) {
    return {
      ok: false,
      status: 403,
      error: "Only SELECT queries are allowed",
      message:
        "Use an admin token with ALLOW_RAW_SQL_ADMIN=true to run write queries",
    };
  }

  if (WRITABLE_CTE_PATTERN.test(rawSql)) {
    return {
      ok: false,
      status: 403,
      error: "Writable CTEs are not allowed in SELECT-only mode",
    };
  }

  if (BLOCKED_KEYWORDS.test(rawSql)) {
    return {
      ok: false,
      status: 403,
      error: "Query contains blocked keywords",
    };
  }

  return { ok: true };
}

function buildExplainPrefix(opts: {
  analyze: boolean;
  buffers: boolean;
  verbose: boolean;
  settings: boolean;
  wal: boolean;
}): string {
  const parts = ["FORMAT JSON"];
  if (opts.analyze) parts.push("ANALYZE");
  if (opts.buffers) parts.push("BUFFERS");
  if (opts.verbose) parts.push("VERBOSE");
  if (opts.settings) parts.push("SETTINGS");
  if (opts.wal) parts.push("WAL");
  return `EXPLAIN (${parts.join(", ")})`;
}

export async function queryRoute(server: FastifyInstance) {
  server.post(
    "/:database/query",
    {
      // authenticateAny: admin token, DB-scoped token ve DB-user token'ları kabul eder.
      // scopeGuard("query"): DB-user token'ları için rol-scope eşlemesini kontrol eder
      //   (editor → query scope var; viewer → yok).
      // authenticateAny olmadan req.dbUser hiç set edilmez → DB-user token 403 alır.
      preHandler: [server.authenticateAny, scopeGuard("query")],
      schema: {
        description:
          "Execute raw SQL. Default: SELECT only. Admin token with ALLOW_RAW_SQL_ADMIN=true enables full SQL.\n\n" +
          "Response shape: `{ rows, total, limit: null, offset: null }`. " +
          "`limit` and `offset` are always null for raw SQL queries — they are " +
          "meaningful only when the API controls pagination (GET /db/:db/:table). " +
          "Use `rows.length` to detect end-of-page for hand-written paginated SQL.",
        tags: ["query"],
        body: {
          type: "object",
          required: ["sql"],
          properties: {
            sql: { type: "string" },
            params: { type: "array", default: [] },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              rows: {
                type: "array",
                items: { type: "object" },
              },
              total: {
                type: "integer",
                description:
                  "Number of rows returned (= rows.length for raw SQL)",
              },
              limit: {
                type: ["integer", "null"],
                description:
                  "Always null for raw SQL — pagination is controlled by the SQL itself",
              },
              offset: {
                type: ["integer", "null"],
                description: "Always null for raw SQL",
              },
            },
          },
        },
      },
    },
    asyncHandler(async (req, reply) => {
      const dbName = req.dbName!;
      const { sql: rawSql, params = [] } = req.body as {
        sql: string;
        params?: unknown[];
      };

      const isAdmin = req.user?.role === "admin";
      const adminFullSqlEnabled = config.ALLOW_RAW_SQL_ADMIN;

      const gate = assertSelectOnlySql(rawSql, !!isAdmin, adminFullSqlEnabled);
      if (!gate.ok) {
        return reply.status(gate.status).send({
          error: gate.error,
          ...(gate.message ? { message: gate.message } : {}),
        });
      }

      const sql = server.poolManager.getPool(dbName);

      let rows: unknown[];
      if (!(isAdmin && adminFullSqlEnabled)) {
        rows = await sql.begin("read only", async (tx) => {
          return tx.unsafe(rawSql, params as never[]);
        });
      } else {
        rows = await sql.unsafe(rawSql, params as never[]);

        if (config.QUERY_LOG_ENABLED) {
          try {
            await insertAuditLog(sql, "raw_sql_exec", req.user?.sub ?? "admin", {
              ip: req.ip,
              userAgent: req.headers["user-agent"] as string | undefined,
              metadata: {
                sql: rawSql.slice(0, 2000),
                role: req.user?.role,
              },
            });
          } catch {
            // Auth schema olmayan DB'lerde audit log yazılamaz
          }
        }
      }

      const normalized = (rows as Record<string, unknown>[]).map((row) => {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(row)) {
          out[k] =
            typeof v === "bigint" ||
            (typeof v === "string" &&
              /^\d+$/.test(v) &&
              Number.isSafeInteger(Number(v)))
              ? Number(v)
              : v;
        }
        return out;
      });

      return reply.send({
        rows: normalized,
        total: normalized.length,
        limit: null,
        offset: null,
      });
    })
  );

  // ── E-87 POST /:database/query/explain ────────────────────────────────────
  server.post(
    "/:database/query/explain",
    {
      preHandler: [server.authenticateAny, scopeGuard("query")],
      schema: {
        description:
          "Run EXPLAIN (FORMAT JSON) on a SQL statement (E-87). " +
          "Returns a structured plan for GUI visualization. " +
          "Same SELECT-only rules as POST /query unless admin + ALLOW_RAW_SQL_ADMIN. " +
          "buffers implies analyze.",
        tags: ["query"],
        body: {
          type: "object",
          required: ["sql"],
          properties: {
            sql: { type: "string" },
            params: { type: "array", default: [] },
            analyze: { type: "boolean", default: false },
            buffers: { type: "boolean", default: false },
            verbose: { type: "boolean", default: false },
            settings: { type: "boolean", default: false },
            wal: { type: "boolean", default: false },
          },
        },
      },
    },
    asyncHandler(async (req, reply) => {
      const dbName = req.dbName!;
      const body = req.body as {
        sql: string;
        params?: unknown[];
        analyze?: boolean;
        buffers?: boolean;
        verbose?: boolean;
        settings?: boolean;
        wal?: boolean;
      };
      const rawSql = body.sql;
      const params = body.params ?? [];

      if (!rawSql?.trim()) {
        return reply.status(400).send({ error: "sql is required" });
      }

      if (rawSql.trim().toUpperCase().startsWith("EXPLAIN")) {
        return reply.status(400).send({
          error: "sql must not include EXPLAIN — this endpoint wraps it",
        });
      }

      // E-87: always SELECT/WITH-only. EXPLAIN does not support DDL, and this
      // endpoint is for plan visualization — never run destructive SQL here
      // even when ALLOW_RAW_SQL_ADMIN is enabled.
      const gate = assertSelectOnlySql(rawSql, false, false);
      if (!gate.ok) {
        return reply.status(gate.status).send({
          error: gate.error,
          ...(gate.message ? { message: gate.message } : {}),
        });
      }

      // PostgreSQL: BUFFERS requires ANALYZE
      const buffers = body.buffers === true;
      const analyze = body.analyze === true || buffers;
      const verbose = body.verbose === true;
      const settings = body.settings === true;
      const wal = body.wal === true;

      const explainSql = `${buildExplainPrefix({
        analyze,
        buffers,
        verbose,
        settings,
        wal,
      })} ${rawSql}`;

      const sql = server.poolManager.getPool(dbName);

      // Always read-only: ANALYZE on SELECT is fine; writes are gated above.
      const rows = (await sql.begin("read only", async (tx) => {
        return tx.unsafe(explainSql, params as never[]);
      })) as Record<string, unknown>[];

      const first = rows[0] ?? {};
      const planJson = first["QUERY PLAN"] ?? first["query plan"] ?? first;
      const plan = Array.isArray(planJson) ? planJson[0] : planJson;
      const planObj =
        plan && typeof plan === "object"
          ? (plan as Record<string, unknown>)
          : null;

      return reply.send({
        Plan: planObj?.Plan ?? plan,
        ...(planObj && "Planning Time" in planObj
          ? { "Planning Time": planObj["Planning Time"] }
          : {}),
        ...(planObj && "Execution Time" in planObj
          ? { "Execution Time": planObj["Execution Time"] }
          : {}),
        options: { analyze, buffers, verbose, settings, wal },
      });
    })
  );
}
