/**
 * GET /:database/auth/audit — Audit log listesi.
 *
 * Sayfalama, event filtresi ve user filtresi desteklenir.
 * Admin scope (schema) gerektirir.
 */

import type { FastifyInstance } from "fastify";
import { asyncHandler } from "../../../utils/asyncHandler.js";
import { scopeGuard } from "../../../middleware/scopeGuard.js";
import { ensureAuthSchema } from "./provision.js";

export async function authAuditRoute(server: FastifyInstance) {
  server.get(
    "/:database/auth/audit",
    {
      preHandler: [server.authenticate, scopeGuard("schema")],
      schema: {
        description: "List auth audit log entries. Requires schema scope.",
        tags: ["db-auth"],
        security: [{ bearerAuth: [] }],
        querystring: {
          type: "object",
          properties: {
            limit:   { type: "integer", default: 50, maximum: 500 },
            offset:  { type: "integer", default: 0 },
            event:   { type: "string" },
            user_id: { type: "string" },
          },
        },
      },
    },
    asyncHandler(async (req, reply) => {
      const { limit = 50, offset = 0, event, user_id } =
        req.query as {
          limit?: number;
          offset?: number;
          event?: string;
          user_id?: string;
        };

      const sql = server.poolManager.getPool(req.dbName!);
      await ensureAuthSchema(sql);

      const rows = await sql`
        SELECT
          a.id,
          a.user_id,
          u.email AS user_email,
          a.event,
          a.ip,
          a.user_agent,
          a.metadata,
          a.created_at
        FROM _postgrify_auth.audit_log a
        LEFT JOIN _postgrify_auth.users u ON u.id = a.user_id
        WHERE
          (${event ?? null} IS NULL OR a.event = ${event ?? ""})
          AND (${user_id ?? null} IS NULL OR a.user_id = ${user_id ?? ""}::uuid)
        ORDER BY a.created_at DESC
        LIMIT ${limit}
        OFFSET ${offset}
      `;

      const [{ count }] = await sql`
        SELECT count(*)::int AS count
        FROM _postgrify_auth.audit_log
        WHERE
          (${event ?? null} IS NULL OR event = ${event ?? ""})
          AND (${user_id ?? null} IS NULL OR user_id = ${user_id ?? ""}::uuid)
      `;

      return reply.send({ data: rows, total: count, limit, offset });
    })
  );
}