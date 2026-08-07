/**
 * Magic Link akışı (şifresiz giriş):
 *
 *   POST /:database/auth/magic-link         — link isteği, email gönder
 *   GET  /:database/auth/magic-link/verify  — token doğrula, session oluştur
 *
 * Kullanıcı yoksa otomatik kayıt yapılır (email_verified=true, şifresiz).
 */

import type { FastifyInstance } from "fastify";
import { asyncHandler } from "../../../utils/asyncHandler.js";
import { ensureAuthSchema, insertAuditLog, getAuthSetting } from "./provision.js";
import { sendEmail, buildMagicLinkEmail } from "../../../services/emailService.js";
import { JwtService } from "../../../services/jwtService.js";
import { config } from "../../../config/env.js";
import crypto from "node:crypto";

const MAGIC_TOKEN_TTL_MS = 15 * 60 * 1000; // 15 dakika

export async function authMagicLinkRoute(server: FastifyInstance) {
  const jwtService = new JwtService(config.JWT_SECRET);

  // ── POST /:database/auth/magic-link ─────────────────────────────────────
  server.post(
    "/:database/auth/magic-link",
    {
      config: { rateLimit: { max: 5, timeWindow: "10 minutes" } },
      schema: {
        description: "Send a magic link to the given email. Creates account if not exists.",
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

      const magicEnabled = await getAuthSetting(sql, "magic_link_enabled", "false");
      if (magicEnabled !== "true") {
        return reply.status(403).send({
          error: "Magic link disabled",
          message: "Magic link sign-in is not enabled for this database.",
        });
      }

      // Kullanıcı yoksa oluştur (email_verified=true, şifresiz)
      let [user] = await sql`
        SELECT id, email, role, is_active
        FROM _postgrify_auth.users
        WHERE email = ${email.toLowerCase()}
      `;

      if (!user) {
        const signupEnabled = await getAuthSetting(sql, "email_signup_enabled", "true");
        if (signupEnabled !== "true") {
          // User enumeration koruması — yine de 200 dön
          return reply.send({ ok: true, message: "Giriş linki email adresinize gönderildi." });
        }

        [user] = await sql`
          INSERT INTO _postgrify_auth.users (email, email_verified, provider)
          VALUES (${email.toLowerCase()}, true, 'email')
          RETURNING id, email, role, is_active
        `;

        await insertAuditLog(sql, "signup", user.id as string, {
          ip: req.ip,
          userAgent: req.headers["user-agent"],
          metadata: { via: "magic_link" },
        });
      }

      if (!user.is_active) {
        // User enumeration koruması
        return reply.send({ ok: true, message: "Giriş linki email adresinize gönderildi." });
      }

      const magicToken = crypto.randomBytes(32).toString("hex");
      const magicExp = new Date(Date.now() + MAGIC_TOKEN_TTL_MS);

      await sql`
        UPDATE _postgrify_auth.users
        SET metadata = jsonb_set(
          jsonb_set(metadata, '{magic_token}', ${JSON.stringify(magicToken)}::jsonb),
          '{magic_token_exp}', ${JSON.stringify(magicExp.toISOString())}::jsonb
        )
        WHERE id = ${user.id}
      `;

      await insertAuditLog(sql, "magic_link_request", user.id as string, {
        ip: req.ip,
        userAgent: req.headers["user-agent"],
      });

      sendEmail(buildMagicLinkEmail({
        appUrl: config.APP_URL,
        database,
        token: magicToken,
        email: user.email as string,
      })).catch((err) => server.log.warn({ err }, "Failed to send magic link email"));

      return reply.send({ ok: true, message: "Giriş linki email adresinize gönderildi." });
    })
  );

  // ── GET /:database/auth/magic-link/verify ───────────────────────────────
  server.get(
    "/:database/auth/magic-link/verify",
    {
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
      schema: {
        description: "Verify a magic link token and return a session.",
        tags: ["db-auth"],
        security: [],
        querystring: {
          type: "object",
          required: ["token"],
          properties: {
            token: { type: "string" },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              accessToken:  { type: "string" },
              refreshToken: { type: "string" },
              expiresIn:    { type: "string" },
              user: {
                type: "object",
                properties: {
                  id:    { type: "string" },
                  email: { type: "string" },
                  role:  { type: "string" },
                },
              },
            },
          },
        },
      },
    },
    asyncHandler(async (req, reply) => {
      const { database } = req.params as { database: string };
      const { token } = req.query as { token: string };

      const sql = server.poolManager.getPool(database);
      await ensureAuthSchema(sql);

      const [user] = await sql`
        SELECT id, email, role, is_active,
               metadata->>'magic_token'     AS magic_token,
               metadata->>'magic_token_exp' AS magic_token_exp
        FROM _postgrify_auth.users
        WHERE metadata->>'magic_token' = ${token}
      `;

      if (!user) {
        return reply.status(400).send({ error: "Invalid or already used magic link token" });
      }

      const exp = new Date(user.magic_token_exp as string);
      if (exp < new Date()) {
        return reply.status(400).send({ error: "Magic link token has expired" });
      }

      if (!user.is_active) {
        return reply.status(403).send({ error: "Account is disabled" });
      }

      // Token'ı tek kullanımlık yap — hemen sil
      await sql`
        UPDATE _postgrify_auth.users
        SET
          last_login     = now(),
          email_verified = true,
          metadata       = metadata - 'magic_token' - 'magic_token_exp'
        WHERE id = ${user.id}
      `;

      const accessToken = await jwtService.signDbUserToken(
        database,
        user.id as string,
        user.email as string,
        user.role as string,
        config.ACCESS_TOKEN_EXPIRY
      );

      const refreshToken = crypto.randomBytes(48).toString("hex");
      const expiresAt = new Date(Date.now() + parseDuration(config.REFRESH_TOKEN_EXPIRY));

      await sql`
        INSERT INTO _postgrify_auth.sessions (user_id, refresh_token, expires_at, ip, user_agent)
        VALUES (${user.id}, ${refreshToken}, ${expiresAt.toISOString()}, ${req.ip}, ${req.headers["user-agent"] ?? null})
      `;

      await insertAuditLog(sql, "magic_link_login", user.id as string, {
        ip: req.ip,
        userAgent: req.headers["user-agent"],
      });

      return reply.send({
        accessToken,
        refreshToken,
        expiresIn: config.ACCESS_TOKEN_EXPIRY,
        user: { id: user.id, email: user.email, role: user.role },
      });
    })
  );
}

function parseDuration(expiry: string): number {
  const match = expiry.match(/^(\d+)([smhd])$/);
  if (!match) return 7 * 24 * 60 * 60 * 1000;
  const value = parseInt(match[1], 10);
  const unit = match[2];
  const multipliers: Record<string, number> = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  return value * (multipliers[unit] ?? 86_400_000);
}