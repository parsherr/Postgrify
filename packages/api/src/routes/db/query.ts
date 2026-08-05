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

const BLOCKED_KEYWORDS = /\b(DROP|TRUNCATE|DELETE|UPDATE|INSERT|ALTER|CREATE|GRANT|REVOKE|EXECUTE|COPY)\b/i;

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

        if (BLOCKED_KEYWORDS.test(rawSql)) {
          return reply.status(403).send({
            error: "Query contains blocked keywords",
          });
        }
      }

      const sql = server.poolManager.getPool(dbName);
      const rows = await sql.unsafe(rawSql, params as never[]);

      return reply.send({ rows, count: rows.length });
    })
  );
}