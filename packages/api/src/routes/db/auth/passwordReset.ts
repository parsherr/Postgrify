/**
 * Şifre sıfırlama akışı:
 *
 *   POST /:database/auth/password/forgot  — sıfırlama linki gönder
 *   POST /:database/auth/password/reset   — token + yeni şifre ile sıfırla
 */

import type { FastifyInstance } from "fastify";
import { asyncHandler } from "../../../utils/asyncHandler.js";
import { hashPassword } from "../../../services/passwordService.js";
import { ensureAuthSchema, insertAuditLog, getAuthSetting } from "./provision.js";
import { sendEmail, buildPasswordResetEmail } from "../../../services/emailService.js";
import { config } from "../../../config/env.js";
import crypto from "node:crypto";
import { validatePassword, parsePolicyFromSettings } from "../../../utils/passwordPolicy.js";

const RATE_LIMIT = { max: 5, timeWindow: "10 minutes" } as const;

export async function authPasswordResetRoute(server: FastifyInstance) {
  // ── POST /:database/auth/password/forgot ────────────────────────────────
  server.post(
    "/:database/auth/password/forgot",
    {
      config: { rateLimit: RATE_LIMIT },
      schema: {
        description: "Request a password reset link via email.",
        tags: ["db-auth"],
        security: [],
        body: {
          type: "object",
          required: ["email"],
          properties: {
            email: { type: "string", format: "email" },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              ok:      { type: "boolean" },
              message: { type: "string" },
            },
          },
        },
      },
    },
    asyncHandler(async (req, reply) => {
      const { database } = req.params as { database: string };
      const { email } = req.body as { email: string };

      const sql = server.poolManager.getPool(database);
      await ensureAuthSchema(sql);

      // Her durumda 200 döndür (user enumeration koruması)
      const [user] = await sql`
        SELECT id, email FROM _postgrify_auth.users
        WHERE email = ${email.toLowerCase()} AND is_active = true
      `;

      if (user) {
        const resetToken = crypto.randomBytes(32).toString("hex");
        // Güvenlik: token'ı düz metin değil SHA-256 hash'i olarak sakla.
        // DB dump'ı veya admin API sızıntısında raw token kullanılamaz.
        const resetTokenHash = crypto.createHash("sha256").update(resetToken).digest("hex");
        const resetExp = new Date(Date.now() + 60 * 60 * 1000); // 1 saat

        await sql`
          UPDATE _postgrify_auth.users
          SET metadata = jsonb_set(
            jsonb_set(metadata, '{reset_token}', ${JSON.stringify(resetTokenHash)}::jsonb),
            '{reset_token_exp}', ${JSON.stringify(resetExp.toISOString())}::jsonb
          )
          WHERE id = ${user.id}
        `;

        await insertAuditLog(sql, "password_reset_request", user.id as string, {
          ip: req.ip,
          userAgent: req.headers["user-agent"],
        });

        sendEmail(buildPasswordResetEmail({
          appUrl: config.APP_URL,
          database,
          token: resetToken,
          email: user.email as string,
        })).catch((err) => server.log.warn({ err }, "Failed to send password reset email"));
      }

      return reply.send({
        ok: true,
        message: "Şifre sıfırlama linki email adresinize gönderildi.",
      });
    })
  );

  // ── POST /:database/auth/password/reset ─────────────────────────────────
  server.post(
    "/:database/auth/password/reset",
    {
      config: { rateLimit: RATE_LIMIT },
      schema: {
        description: "Reset password using a token from the forgot-password email.",
        tags: ["db-auth"],
        security: [],
        body: {
          type: "object",
          required: ["token", "password"],
          properties: {
            token:    { type: "string" },
            password: { type: "string", minLength: 8 },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              ok:      { type: "boolean" },
              message: { type: "string" },
            },
          },
        },
      },
    },
    asyncHandler(async (req, reply) => {
      const { database } = req.params as { database: string };
      const { token, password } = req.body as { token: string; password: string };

      const sql = server.poolManager.getPool(database);
      await ensureAuthSchema(sql);

      // Gelen token'ı hash'leyip DB'deki hash ile karşılaştır (timing-safe DB lookup)
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

      // Savunma: reset_token_exp NULL veya parse edilemezse token geçersiz say.
      // new Date(undefined) = Invalid Date → isNaN kontrolü kritik.
      // new Date(null)      = epoch (1970) → zaten expired olur, ama null'ı
      //   açıkça yakalayıp reddetmek daha güvenli.
      const rawExp = user.reset_token_exp as string | null | undefined;
      if (!rawExp) {
        return reply.status(400).send({ error: "Invalid or expired reset token" });
      }
      const exp = new Date(rawExp);
      if (isNaN(exp.getTime()) || exp < new Date()) {
        return reply.status(400).send({ error: "Reset token has expired" });
      }

      // Yeni şifre kompleksitesini politikaya göre doğrula
      const policySettings: Record<string, string> = {
        min_password_length:        await getAuthSetting(sql, "min_password_length",        "8"),
        password_require_uppercase: await getAuthSetting(sql, "password_require_uppercase", "false"),
        password_require_number:    await getAuthSetting(sql, "password_require_number",    "false"),
        password_require_special:   await getAuthSetting(sql, "password_require_special",   "false"),
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
          metadata = metadata - 'reset_token' - 'reset_token_exp'
        WHERE id = ${user.id}
      `;

      // Tüm session'ları revoke et
      await sql`
        UPDATE _postgrify_auth.sessions
        SET revoked = true
        WHERE user_id = ${user.id} AND revoked = false
      `;

      await insertAuditLog(sql, "password_reset", user.id as string, {
        ip: req.ip,
        userAgent: req.headers["user-agent"],
      });

      return reply.send({ ok: true, message: "Şifreniz güncellendi. Lütfen tekrar giriş yapın." });
    })
  );
}