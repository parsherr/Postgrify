/**
 * Per-DB Session yönetimi:
 *
 *   GET    /:database/auth/sessions           — aktif session listesi
 *   DELETE /:database/auth/sessions/:id       — belirli session'ı revoke et
 *   DELETE /:database/auth/sessions?user_id=  — kullanıcının tüm session'larını revoke et
 *
 * Admin scope gerektirir.
 */

import type { FastifyInstance } from "fastify";
import { asyncHandler } from "../../../utils/asyncHandler.js";
import { scopeGuard } from "../../../middleware/scopeGuard.js";
import { ensureAuthSchema } from "./provision.js";

export async function authSessionsRoute(server: FastifyInstance) {
  const adminGuard = [server.authenticate, scopeGuard("schema")] as const;

  // ── GET /:database/auth/sessions ─────────────────────────────────────────
  server.get(
    "/:database/auth/sessions",
    {
      preHandler: [...adminGuard],
      schema: {
        description: "List all active sessions. Requires schema scope.",
        tags: ["db-auth"],
        security: [{ bearerAuth: [] }],
        querystring: {
          type: "object",
          properties: {
            user_id: { type: "string" },
            limit:   { type: "integer", default: 100, maximum: 500 },
            offset:  { type: "integer", default: 0 },
          },
        },
      },
    },
    asyncHandler(async (req, reply) => {
      const { user_id, limit = 100, offset = 0 } =
        req.query as { user_id?: string; limit?: number; offset?: number };

      const sql = server.poolManager.getPool(req.dbName!);
      await ensureAuthSchema(sql);

      const rows = await sql`
        SELECT
          s.id,
          s.user_id,
          u.email AS user_email,
          s.expires_at,
          s.created_at,
          s.revoked,
          s.ip,
          s.user_agent
        FROM _postgrify_auth.sessions s
        LEFT JOIN _postgrify_auth.users u ON u.id = s.user_id
        WHERE
          s.revoked = false
          AND s.expires_at > now()
          AND (${user_id ?? null} IS NULL OR s.user_id = ${user_id ?? ""}::uuid)
        ORDER BY s.created_at DESC
        LIMIT ${limit}
        OFFSET ${offset}
      `;

      const [{ count }] = await sql`
        SELECT count(*)::int AS count
        FROM _postgrify_auth.sessions
        WHERE revoked = false AND expires_at > now()
          AND (${user_id ?? null} IS NULL OR user_id = ${user_id ?? ""}::uuid)
      `;

      return reply.send({ data: rows, total: count });
    })
  );

  // ── DELETE /:database/auth/sessions/:id ──────────────────────────────────
  server.delete(
    "/:database/auth/sessions/:id",
    {
      preHandler: [...adminGuard],
      schema: {
        description: "Revoke a specific session by ID.",
        tags: ["db-auth"],
        security: [{ bearerAuth: [] }],
      },
    },
    asyncHandler(async (req, reply) => {
      const { id } = req.params as { id: string };
      const sql = server.poolManager.getPool(req.dbName!);
      await ensureAuthSchema(sql);

      await sql`
        UPDATE _postgrify_auth.sessions
        SET revoked = true
        WHERE id = ${id}
      `;

      return reply.status(204).send();
    })
  );

  // ── DELETE /:database/auth/sessions?user_id= ────────────────────────────
  server.delete(
    "/:database/auth/sessions",
    {
      preHandler: [...adminGuard],
      schema: {
        description: "Revoke all sessions for a user.",
        tags: ["db-auth"],
        security: [{ bearerAuth: [] }],
        querystring: {
          type: "object",
          required: ["user_id"],
          properties: {
            user_id: { type: "string" },
          },
        },
      },
    },
    asyncHandler(async (req, reply) => {
      const { user_id } = req.query as { user_id: string };
      const sql = server.poolManager.getPool(req.dbName!);
      await ensureAuthSchema(sql);

      await sql`
        UPDATE _postgrify_auth.sessions
        SET revoked = true
        WHERE user_id = ${user_id}::uuid AND revoked = false
      `;

      return reply.status(204).send();
    })
  );
}