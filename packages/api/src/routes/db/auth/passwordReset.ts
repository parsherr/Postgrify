/**
 * Password reset (C-15 / C-16):
 *
 *   POST /:database/auth/password/forgot  — empty {} response; redirect_to optional
 *   POST /:database/auth/password/reset   — {} or 204-style ok; revoke sessions toggle
 */

import type { FastifyInstance } from "fastify";
import { asyncHandler } from "../../../utils/asyncHandler.js";
import { hashPassword } from "../../../services/passwordService.js";
import { ensureAuthSchema, insertAuditLog, getAuthSetting } from "./provision.js";
import { sendEmail, buildPasswordResetEmail } from "../../../services/emailService.js";
import { config } from "../../../config/env.js";
import { safeAppRedirect } from "./redirectSafe.js";
import crypto from "node:crypto";
import { validatePassword, parsePolicyFromSettings } from "../../../utils/passwordPolicy.js";

const RATE_LIMIT = { max: 5, timeWindow: "10 minutes" } as const;
const DEFAULT_RESET_TTL_MS = 24 * 60 * 60 * 1000;

async function resetTtlMs(sql: Parameters<typeof getAuthSetting>[0]): Promise<number> {
  const raw = await getAuthSetting(sql, "password_reset_ttl_hours", "24");
  const hours = parseInt(raw, 10);
  if (!Number.isFinite(hours) || hours <= 0 || hours > 168) return DEFAULT_RESET_TTL_MS;
  return hours * 60 * 60 * 1000;
}

export async function authPasswordResetRoute(server: FastifyInstance) {
  // ── POST /:database/auth/password/forgot (C-15) ─────────────────────────
  server.post(
    "/:database/auth/password/forgot",
    {
      config: { rateLimit: RATE_LIMIT },
      schema: {
        description:
          "Request password reset email (C-15). Always returns {} (anti-enumeration).",
        tags: ["db-auth"],
        security: [],
        body: {
          type: "object",
          required: ["email"],
          properties: {
            email: { type: "string", format: "email" },
            redirect_to: { type: "string" },
          },
        },
        response: {
          200: { type: "object", additionalProperties: false },
        },
      },
    },
    asyncHandler(async (req, reply) => {
      const { database } = req.params as { database: string };
      const { email, redirect_to: redirectTo } = req.body as {
        email: string;
        redirect_to?: string;
      };

      const sql = server.poolManager.getPool(database);
      await ensureAuthSchema(sql);

      const [user] = await sql`
        SELECT id, email FROM _postgrify_auth.users
        WHERE email = ${email.toLowerCase()} AND is_active = true
      `;

      if (user) {
        const resetToken = crypto.randomBytes(32).toString("hex");
        const resetTokenHash = crypto.createHash("sha256").update(resetToken).digest("hex");
        const resetExp = new Date(Date.now() + (await resetTtlMs(sql)));
        const safeRedirect = redirectTo ? safeAppRedirect(redirectTo) : null;

        await sql`
          UPDATE _postgrify_auth.users
          SET metadata = jsonb_set(
            jsonb_set(metadata, '{reset_token}', ${JSON.stringify(resetTokenHash)}::jsonb),
            '{reset_token_exp}', ${JSON.stringify(resetExp.toISOString())}::jsonb
          )
          WHERE id = ${user.id}
        `;
        if (safeRedirect) {
          await sql`
            UPDATE _postgrify_auth.users
            SET metadata = jsonb_set(
              metadata,
              '{reset_redirect_to}',
              ${JSON.stringify(safeRedirect)}::jsonb
            )
            WHERE id = ${user.id}
          `;
        }

        await insertAuditLog(sql, "password_reset_request", user.id as string, {
          ip: req.ip,
          userAgent: req.headers["user-agent"],
        });

        sendEmail(
          buildPasswordResetEmail({
            appUrl: config.APP_URL,
            database,
            token: resetToken,
            email: user.email as string,
            redirectTo: safeRedirect ?? undefined,
          })
        ).catch((err) => server.log.warn({ err }, "Failed to send password reset email"));
      }

      return reply.send({});
    })
  );

  // ── POST /:database/auth/password/reset (C-16) ──────────────────────────
  server.post(
    "/:database/auth/password/reset",
    {
      config: { rateLimit: RATE_LIMIT },
      schema: {
        description: "Reset password with email token (C-16). Returns {}.",
        tags: ["db-auth"],
        security: [],
        body: {
          type: "object",
          required: ["token", "password"],
          properties: {
            token: { type: "string" },
            password: { type: "string", minLength: 8 },
          },
        },
        response: {
          200: { type: "object", additionalProperties: false },
        },
      },
    },
    asyncHandler(async (req, reply) => {
      const { database } = req.params as { database: string };
      const { token, password } = req.body as { token: string; password: string };

      const sql = server.poolManager.getPool(database);
      await ensureAuthSchema(sql);

      const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

      const [user] = await sql`
        SELECT id, email,
               metadata->>'reset_token_exp' AS reset_token_exp
        FROM _postgrify_auth.users
        WHERE metadata->>'reset_token' = ${tokenHash}
          AND is_active = true
      `;

      if (!user) {
        return reply.status(400).send({ error: "Invalid or expired reset token" });
      }

      const rawExp = user.reset_token_exp as string | null | undefined;
      if (!rawExp) {
        return reply.status(400).send({ error: "Invalid or expired reset token" });
      }
      const exp = new Date(rawExp);
      if (isNaN(exp.getTime()) || exp < new Date()) {
        return reply.status(400).send({ error: "Reset token has expired" });
      }

      const policySettings: Record<string, string> = {
        min_password_length: await getAuthSetting(sql, "min_password_length", "8"),
        password_require_uppercase: await getAuthSetting(
          sql,
          "password_require_uppercase",
          "false"
        ),
        password_require_number: await getAuthSetting(
          sql,
          "password_require_number",
          "false"
        ),
        password_require_special: await getAuthSetting(
          sql,
          "password_require_special",
          "false"
        ),
      };
      const policyCheck = validatePassword(password, parsePolicyFromSettings(policySettings));
      if (!policyCheck.valid) {
        return reply.status(400).send({ error: policyCheck.message });
      }

      const newHash = await hashPassword(password);

      await sql`
        UPDATE _postgrify_auth.users
        SET
          password_hash = ${newHash},
          metadata = metadata - 'reset_token' - 'reset_token_exp' - 'reset_redirect_to'
        WHERE id = ${user.id}
      `;

      const revokeSessions =
        (await getAuthSetting(sql, "revoke_sessions_on_password_reset", "true")) === "true";
      if (revokeSessions) {
        await sql`
          UPDATE _postgrify_auth.sessions
          SET revoked = true, revoked_at = COALESCE(revoked_at, now())
          WHERE user_id = ${user.id} AND revoked = false
        `;
      }

      await insertAuditLog(sql, "password_reset", user.id as string, {
        ip: req.ip,
        userAgent: req.headers["user-agent"],
        metadata: { sessions_revoked: revokeSessions },
      });

      return reply.send({});
    })
  );
}
