/**
 * E-41: Admin ban / unban user.
 *
 *   POST /:database/auth/admin/users/:id/ban
 *   Body: { ban_duration: "24h" | "72h" | "none" | ... }
 *
 * Sets users.locked_until (same field as C-18 ban_duration). On ban, revokes
 * all active sessions so existing refresh tokens stop working.
 */

import type { FastifyInstance } from "fastify";
import { asyncHandler } from "../../../utils/asyncHandler.js";
import { scopeGuard } from "../../../middleware/scopeGuard.js";
import { ensureAuthSchema, insertAuditLog } from "./provision.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const DURATION_MULT_MS: Record<string, number> = {
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

/** Far-future lock used for indefinite bans. */
const PERMANENT_BAN_UNTIL = "9999-12-31T23:59:59.999Z";

export type BanDurationResult =
  | { ok: true; until: Date | null }
  | { ok: false; error: string };

/**
 * Parse GoTrue-style ban_duration.
 * - "none" / "0" → unban
 * - "24h", "30d", … → timed ban
 * - "permanent" → indefinite ban
 */
export function parseBanDuration(raw: string): BanDurationResult {
  const value = raw.trim().toLowerCase();
  if (value === "none" || value === "0") {
    return { ok: true, until: null };
  }
  if (value === "permanent" || value === "indefinite") {
    return { ok: true, until: new Date(PERMANENT_BAN_UNTIL) };
  }
  const match = value.match(/^(\d+)([smhd])$/);
  if (!match) {
    return {
      ok: false,
      error: 'Invalid ban_duration (use e.g. "24h", "72h", "permanent", or "none")',
    };
  }
  const n = parseInt(match[1], 10);
  // Max ~100 years in seconds to prevent overflow / Invalid Date from Date.now() + n*mult.
  const MAX_SECONDS = 60 * 60 * 24 * 365 * 100;
  if (!Number.isFinite(n) || n <= 0 || n * (DURATION_MULT_MS[match[2]] / 1000) > MAX_SECONDS) {
    return { ok: false, error: "ban_duration must be a positive duration (max 100 years)" };
  }
  const mult = DURATION_MULT_MS[match[2]];
  return { ok: true, until: new Date(Date.now() + n * mult) };
}

export async function authBanRoute(server: FastifyInstance) {
  const schemaGuard = [server.authenticate, scopeGuard("schema")] as const;

  server.post(
    "/:database/auth/admin/users/:id/ban",
    {
      preHandler: [...schemaGuard],
      schema: {
        description:
          "Ban or unban an auth user (E-41). Sets locked_until; ban_duration " +
          '"none" clears the ban. Active sessions are revoked on ban. Requires schema scope.',
        tags: ["db-auth"],
        security: [{ bearerAuth: [] }],
        params: {
          type: "object",
          required: ["database", "id"],
          properties: {
            database: { type: "string" },
            id: { type: "string", format: "uuid" },
          },
        },
        body: {
          type: "object",
          required: ["ban_duration"],
          properties: {
            ban_duration: {
              type: "string",
              description:
                'e.g. "24h", "72h", "permanent", or "none" to unban',
            },
          },
        },
      },
    },
    asyncHandler(async (req, reply) => {
      const { id } = req.params as { id: string };
      if (!UUID_RE.test(id)) {
        return reply.status(400).send({
          error: "Invalid user id",
          message: "id must be a UUID",
        });
      }

      const { ban_duration: banDuration } = req.body as {
        ban_duration: string;
      };
      const parsed = parseBanDuration(banDuration);
      if (!parsed.ok) {
        return reply.status(400).send({ error: parsed.error });
      }

      const sql = server.poolManager.getPool(req.dbName!);
      await ensureAuthSchema(sql);

      const [user] = await sql`
        SELECT id FROM _postgrify_auth.users WHERE id = ${id}::uuid LIMIT 1
      `;
      if (!user) {
        return reply.status(404).send({ error: "User not found" });
      }

      const bannedUntil = parsed.until;
      const [updated] = await sql`
        UPDATE _postgrify_auth.users
        SET locked_until = ${bannedUntil}
        WHERE id = ${id}::uuid
        RETURNING id, locked_until
      `;

      if (bannedUntil) {
        await sql`
          UPDATE _postgrify_auth.sessions
          SET revoked = true, revoked_at = COALESCE(revoked_at, now())
          WHERE user_id = ${id}::uuid AND revoked = false
        `;
      }

      await insertAuditLog(sql, "user_ban", id, {
        ip: req.ip,
        userAgent: req.headers["user-agent"],
        metadata: {
          ban_duration: banDuration,
          banned_until: bannedUntil ? bannedUntil.toISOString() : null,
        },
      });

      const untilRaw = updated?.locked_until as string | Date | null | undefined;
      const banned_until =
        untilRaw == null
          ? null
          : untilRaw instanceof Date
            ? untilRaw.toISOString()
            : new Date(untilRaw).toISOString();

      return reply.send({
        id: String(updated.id),
        banned_until,
      });
    })
  );
}
