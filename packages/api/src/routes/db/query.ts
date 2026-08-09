/**
 * POST /db/:database/query — Ham SQL çalıştırma.
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

const BLOCKED_KEYWORDS = /\b(DROP|TRUNCATE|DELETE|UPDATE|INSERT|ALTER|CREATE|GRANT|REVOKE|EXECUTE|COPY)\b/i;

// WITH ... (INSERT|UPDATE|DELETE|...) SELECT şeklindeki writeable CTE'leri yakalar
const WRITABLE_CTE_PATTERN = /\bWITH\b[\s\S]*?\b(INSERT|UPDATE|DELETE|TRUNCATE|DROP|ALTER|CREATE)\b/i;

export async function queryRoute(server: FastifyInstance) {
  server.post(
    "/:database/query",
    {
      preHandler: [scopeGuard("query")],
      schema: {
        description: "Execute raw SQL. Default: SELECT only. Admin token enables full SQL.",
        tags: ["query"],
        body: {
          type: "object",
          required: ["sql"],
          properties: {
            sql: { type: "string" },
            params: { type: "array", default: [] },
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

      // SELECT-only mod kontrolü
      if (!(isAdmin && adminFullSqlEnabled)) {
        const trimmed = rawSql.trim().toUpperCase();
        if (!trimmed.startsWith("SELECT") && !trimmed.startsWith("WITH")) {
          return reply.status(403).send({
            error: "Only SELECT queries are allowed",
            message:
              "Use an admin token with ALLOW_RAW_SQL_ADMIN=true to run write queries",
          });
        }

        // Writeable CTE bypass koruması: WITH ... (INSERT|UPDATE|DELETE|...) SELECT
        // BLOCKED_KEYWORDS'den önce kontrol edilmeli — daha spesifik hata mesajı döner
        if (WRITABLE_CTE_PATTERN.test(rawSql)) {
          return reply.status(403).send({
            error: "Writable CTEs are not allowed in SELECT-only mode",
          });
        }

        if (BLOCKED_KEYWORDS.test(rawSql)) {
          return reply.status(403).send({
            error: "Query contains blocked keywords",
          });
        }
      }

      const sql = server.poolManager.getPool(dbName);

      // SELECT-only modda read-only transaction içinde çalıştır
      let rows: unknown[];
      if (!(isAdmin && adminFullSqlEnabled)) {
        rows = await sql.begin("read only", async (tx) => {
          return tx.unsafe(rawSql, params as never[]);
        });
      } else {
        rows = await sql.unsafe(rawSql, params as never[]);

        // Güvenlik audit: QUERY_LOG_ENABLED=true iken admin full-SQL sorgularını kaydet.
        // Bu özellikle DROP, DELETE, UPDATE gibi destructive sorgular için kritik.
        if (config.QUERY_LOG_ENABLED) {
          // insertAuditLog _postgrify_auth schema'sını bekler;
          // yoksa hata yoksayılır — audit log asıl işlemi engellememeli.
          try {
            await insertAuditLog(sql, "raw_sql_exec", req.user?.sub ?? "admin", {
              ip: req.ip,
              userAgent: req.headers["user-agent"] as string | undefined,
              metadata: {
                sql: rawSql.slice(0, 2000), // çok uzun sorguları kırp
                role: req.user?.role,
              },
            });
          } catch {
            // Auth schema olmayan DB'lerde audit log yazılamaz — önemli değil
          }
        }
      }

      return reply.send({ rows: rows as Record<string, unknown>[], count: (rows as unknown[]).length });
    })
  );
}