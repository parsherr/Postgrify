/**
 * E-38: Admin get user by id (GoTrue-shaped).
 *
 *   GET /:database/auth/admin/users/:id
 *
 * Auth: schema scope. MFA factors always [] (ADR-010). Identities synthesized
 * from users.provider / provider_id. Active sessions included (no refresh tokens).
 */

import type { FastifyInstance } from "fastify";
import { asyncHandler } from "../../../utils/asyncHandler.js";
import { scopeGuard } from "../../../middleware/scopeGuard.js";
import { ensureAuthSchema } from "./provision.js";
import {
  buildGoTrueUser,
  type AuthUserRow,
} from "./sessionResponse.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const SENSITIVE_METADATA_KEYS = [
  "reset_token",
  "reset_token_expires",
  "reset_token_exp",
  "magic_link_token",
  "magic_link_token_expires",
  "magic_token",
  "magic_token_expires",
  "magic_token_exp",
  "verification_token",
  "verification_token_expires",
  "verification_exp",
  // email change tokens
  "email_change_token",
  "email_change_token_expires",
  "email_change_token_exp",
  "new_email",
  // OTP / phone
  "otp",
  "otp_expires",
  "otp_exp",
  "phone_change_token",
];

function stripSensitiveMetadata(
  metadata: unknown
): Record<string, unknown> {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return {};
  }
  const cleaned = { ...(metadata as Record<string, unknown>) };
  for (const key of SENSITIVE_METADATA_KEYS) {
    delete cleaned[key];
  }
  return cleaned;
}

function toIso(v: string | Date | null | undefined): string | null {
  if (!v) return null;
  return v instanceof Date ? v.toISOString() : new Date(v).toISOString();
}

function buildIdentity(user: {
  id: string;
  email: string;
  provider: string | null;
  provider_id: string | null;
  created_at: string | Date | null;
  updated_at: string | Date | null;
  last_login: string | Date | null;
}) {
  const provider = user.provider || "email";
  const createdAt = toIso(user.created_at) ?? new Date().toISOString();
  const updatedAt = toIso(user.updated_at) ?? createdAt;

  return {
    id: user.provider_id || user.id,
    user_id: user.id,
    identity_data: {
      sub: user.provider_id || user.id,
      email: user.email,
    },
    provider,
    created_at: createdAt,
    updated_at: updatedAt,
    last_sign_in_at: toIso(user.last_login),
  };
}

export async function authAdminUsersRoute(server: FastifyInstance) {
  const schemaGuard = [server.authenticate, scopeGuard("schema")] as const;

  // ── E-38 GET /:database/auth/admin/users/:id ──────────────────────────────
  server.get(
    "/:database/auth/admin/users/:id",
    {
      preHandler: [...schemaGuard],
      schema: {
        description:
          "Get a single auth user by id (GoTrue admin shape). Includes " +
          "identities, empty factors[], and active sessions. Requires schema scope.",
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

      const sql = server.poolManager.getPool(req.dbName!);
      await ensureAuthSchema(sql);

      const [row] = await sql`
        SELECT
          id,
          email,
          role,
          is_active,
          created_at,
          updated_at,
          last_login,
          email_verified,
          full_name,
          avatar_url,
          provider,
          provider_id,
          metadata
        FROM _postgrify_auth.users
        WHERE id = ${id}::uuid
        LIMIT 1
      `;

      if (!row) {
        return reply.status(404).send({ error: "User not found" });
      }

      const meta = stripSensitiveMetadata(row.metadata);
      const authRow: AuthUserRow = {
        id: String(row.id),
        email: String(row.email),
        role: String(row.role),
        is_active: row.is_active !== false,
        email_verified: Boolean(row.email_verified),
        created_at: row.created_at as string | Date | null,
        metadata: meta,
        provider: row.provider as string | null,
        full_name: row.full_name as string | null,
        avatar_url: row.avatar_url as string | null,
      };

      const base = buildGoTrueUser(authRow);
      const lastSignInAt =
        row.last_login instanceof Date
          ? row.last_login.toISOString()
          : row.last_login
            ? new Date(String(row.last_login)).toISOString()
            : null;

      const sessions = await sql`
        SELECT
          id,
          created_at,
          expires_at,
          ip,
          user_agent
        FROM _postgrify_auth.sessions
        WHERE user_id = ${id}::uuid
          AND revoked = false
          AND expires_at > now()
        ORDER BY created_at DESC
        LIMIT 100
      `;

      return reply.send({
        ...base,
        phone: null,
        phone_confirmed_at: null,
        last_sign_in_at: lastSignInAt,
        identities: [
          buildIdentity({
            id: String(row.id),
            email: String(row.email),
            provider: (row.provider as string | null) ?? "email",
            provider_id: (row.provider_id as string | null) ?? null,
            created_at: row.created_at as string | Date | null,
            updated_at: row.updated_at as string | Date | null,
            last_login: row.last_login as string | Date | null,
          }),
        ],
        // ADR-010: MFA not in scope
        factors: [],
        sessions,
      });
    })
  );
}
