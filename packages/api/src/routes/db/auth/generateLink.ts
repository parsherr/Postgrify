/**
 * E-39: Admin generate-link (no email sent — returns action_link for custom mailers).
 *
 *   POST /:database/auth/admin/generate-link
 *
 * Supported types: signup | magiclink | recovery
 * Unsupported (400): email_change | phone_change
 */

import type { FastifyInstance } from "fastify";
import crypto from "node:crypto";
import { asyncHandler } from "../../../utils/asyncHandler.js";
import { scopeGuard } from "../../../middleware/scopeGuard.js";
import { config } from "../../../config/env.js";
import {
  ensureAuthSchema,
  insertAuditLog,
  getAuthSetting,
} from "./provision.js";
import { safeAppRedirect } from "./redirectSafe.js";

const SUPPORTED_TYPES = new Set(["signup", "magiclink", "recovery"]);
const UNSUPPORTED_TYPES = new Set(["email_change", "phone_change"]);

const DEFAULT_MAGIC_TTL_MS = 15 * 60 * 1000;
const DEFAULT_RESET_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_VERIFY_TTL_MS = 24 * 60 * 60 * 1000;

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function newRawToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

function newEmailOtp(): string {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
}

/** Normalize user.metadata to a plain object (legacy rows may be string/array scalars). */
function asMetaObject(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return { ...(raw as Record<string, unknown>) };
  }
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return { ...(parsed as Record<string, unknown>) };
      }
    } catch {
      // ignore malformed legacy metadata
    }
  }
  return {};
}

async function magicTtlMs(
  sql: Parameters<typeof getAuthSetting>[0]
): Promise<number> {
  const raw = await getAuthSetting(sql, "magic_link_ttl_minutes", "15");
  const minutes = parseInt(raw, 10);
  if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 24 * 60) {
    return DEFAULT_MAGIC_TTL_MS;
  }
  return minutes * 60_000;
}

async function resetTtlMs(
  sql: Parameters<typeof getAuthSetting>[0]
): Promise<number> {
  const raw = await getAuthSetting(sql, "password_reset_ttl_hours", "24");
  const hours = parseInt(raw, 10);
  if (!Number.isFinite(hours) || hours <= 0 || hours > 168) {
    return DEFAULT_RESET_TTL_MS;
  }
  return hours * 60 * 60 * 1000;
}

function buildActionLink(
  type: string,
  database: string,
  token: string,
  redirectTo: string | null
): string {
  const base = config.APP_URL.replace(/\/$/, "");
  if (type === "magiclink") {
    const u = new URL(`${base}/db/${database}/auth/magic-link/verify`);
    u.searchParams.set("token", token);
    if (redirectTo) u.searchParams.set("redirect_to", redirectTo);
    return u.toString();
  }
  if (type === "signup") {
    const u = new URL(`${base}/db/${database}/auth/verify`);
    u.searchParams.set("token", token);
    if (redirectTo) u.searchParams.set("redirect_to", redirectTo);
    return u.toString();
  }
  // recovery — same shape as password-reset email CTA
  const params = new URLSearchParams({ token, database });
  if (redirectTo) params.set("redirect_to", redirectTo);
  return `${base}/reset-password?${params.toString()}`;
}

export async function authGenerateLinkRoute(server: FastifyInstance) {
  const schemaGuard = [server.authenticate, scopeGuard("schema")] as const;

  server.post(
    "/:database/auth/admin/generate-link",
    {
      preHandler: [...schemaGuard],
      schema: {
        description:
          "Generate an auth action link without sending email (E-39). " +
          "Types: signup, magiclink, recovery. Requires schema scope.",
        tags: ["db-auth"],
        security: [{ bearerAuth: [] }],
        body: {
          type: "object",
          required: ["type", "email"],
          properties: {
            type: {
              type: "string",
              enum: [
                "signup",
                "magiclink",
                "recovery",
                "email_change",
                "phone_change",
              ],
            },
            email: { type: "string", format: "email" },
            redirect_to: { type: "string" },
          },
        },
      },
    },
    asyncHandler(async (req, reply) => {
      const { database } = req.params as { database: string };
      const body = req.body as {
        type: string;
        email: string;
        redirect_to?: string;
      };
      const type = body.type;
      const email = body.email.toLowerCase();

      if (UNSUPPORTED_TYPES.has(type)) {
        return reply.status(400).send({
          error: "Unsupported link type",
          message: `type "${type}" is not supported yet (ADR-010 / no phone auth)`,
        });
      }
      if (!SUPPORTED_TYPES.has(type)) {
        return reply.status(400).send({
          error: "Invalid link type",
          message: `type must be one of: ${[...SUPPORTED_TYPES].join(", ")}`,
        });
      }

      const sql = server.poolManager.getPool(database);
      await ensureAuthSchema(sql);

      const redirectTo = body.redirect_to
        ? safeAppRedirect(body.redirect_to)
        : null;

      let [user] = await sql`
        SELECT id, email, is_active, email_verified, metadata
        FROM _postgrify_auth.users
        WHERE email = ${email}
      `;

      if (type === "recovery") {
        if (!user || !user.is_active) {
          return reply.status(404).send({
            error: "User not found",
            message: "No active user with that email",
          });
        }
      } else if (type === "signup") {
        if (user && user.email_verified) {
          return reply.status(422).send({
            error: "User already verified",
            message: "Use magiclink or recovery for existing verified users",
          });
        }
        if (!user) {
          [user] = await sql`
            INSERT INTO _postgrify_auth.users (email, email_verified, provider)
            VALUES (${email}, false, 'email')
            RETURNING id, email, is_active, email_verified, metadata
          `;
        }
      } else {
        // magiclink — create if missing (same as public magic-link flow)
        if (!user) {
          [user] = await sql`
            INSERT INTO _postgrify_auth.users (email, email_verified, provider)
            VALUES (${email}, true, 'email')
            RETURNING id, email, is_active, email_verified, metadata
          `;
        }
        if (!user.is_active) {
          return reply.status(403).send({
            error: "Account is disabled",
          });
        }
      }

      const rawToken = newRawToken();
      const tokenHash = hashToken(rawToken);
      const emailOtp = newEmailOtp();
      let expiresAt: Date;
      const meta = asMetaObject(user.metadata);

      if (type === "magiclink") {
        expiresAt = new Date(Date.now() + (await magicTtlMs(sql)));
        meta.magic_token = tokenHash;
        meta.magic_token_exp = expiresAt.toISOString();
      } else if (type === "recovery") {
        expiresAt = new Date(Date.now() + (await resetTtlMs(sql)));
        meta.reset_token = tokenHash;
        meta.reset_token_exp = expiresAt.toISOString();
        if (redirectTo) meta.reset_redirect_to = redirectTo;
      } else {
        // signup verification
        expiresAt = new Date(Date.now() + DEFAULT_VERIFY_TTL_MS);
        meta.verification_token = tokenHash;
        meta.verification_exp = expiresAt.toISOString();
      }

      // Full-object write — ::text::jsonb avoids postgres.js double-encoding
      // (same pattern as me.ts). Also repairs legacy string/array metadata rows.
      await sql`
        UPDATE _postgrify_auth.users
        SET metadata = ${JSON.stringify(meta)}::text::jsonb
        WHERE id = ${user.id}
      `;

      await insertAuditLog(sql, "generate_link", user.id as string, {
        ip: req.ip,
        userAgent: req.headers["user-agent"],
        metadata: { type, email },
      });

      const actionLink = buildActionLink(type, database, rawToken, redirectTo);

      return reply.send({
        action_link: actionLink,
        email_otp: emailOtp,
        hashed_token: tokenHash,
        verification_type: type,
        redirect_to: redirectTo,
        expires_at: Math.floor(expiresAt.getTime() / 1000),
        user: {
          id: user.id,
          email: user.email,
        },
      });
    })
  );
}
