/**
 * Magic Link akışı (şifresiz giriş):
 *
 *   POST /:database/auth/magic-link         — link isteği, email gönder
 *   GET  /:database/auth/magic-link/verify  — token doğrula, session oluştur
 *
 * Kullanıcı yoksa otomatik kayıt yapılır (email_verified=true, şifresiz).
 */

import type postgres from "postgres";
import type { FastifyInstance } from "fastify";
import { asyncHandler } from "../../../utils/asyncHandler.js";
import { ensureAuthSchema, insertAuditLog, getAuthSetting } from "./provision.js";
import { sendEmail, buildMagicLinkEmail } from "../../../services/emailService.js";
import { JwtService } from "../../../services/jwtService.js";
import { config } from "../../../config/env.js";
import {
  buildSessionResponse,
  parseDurationMs,
} from "./sessionResponse.js";
import { safeAppRedirect, sessionFragment } from "./redirectSafe.js";
import crypto from "node:crypto";

const DEFAULT_MAGIC_TTL_MS = 15 * 60 * 1000;

async function magicLinkTtlMs(sql: postgres.Sql): Promise<number> {
  const raw = await getAuthSetting(sql, "magic_link_ttl_minutes", "15");
  const minutes = parseInt(raw, 10);
  if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 24 * 60) {
    return DEFAULT_MAGIC_TTL_MS;
  }
  return minutes * 60_000;
}

export async function authMagicLinkRoute(server: FastifyInstance) {
  const jwtService = new JwtService(() => config.JWT_SECRET);

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
      // Güvenlik: token hash'i sakla, raw token'ı değil.
      const magicTokenHash = crypto.createHash("sha256").update(magicToken).digest("hex");
      const magicExp = new Date(Date.now() + (await magicLinkTtlMs(sql)));

      await sql`
        UPDATE _postgrify_auth.users
        SET metadata = jsonb_set(
          jsonb_set(metadata, '{magic_token}', ${JSON.stringify(magicTokenHash)}::jsonb),
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

  // ── GET /:database/auth/magic-link/verify (C-12) ────────────────────────
  server.get(
    "/:database/auth/magic-link/verify",
    {
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
      schema: {
        description:
          "Verify magic link token (C-12). JSON GoTrue session or redirect_to fragment.",
        tags: ["db-auth"],
        security: [],
        querystring: {
          type: "object",
          required: ["token"],
          properties: {
            token: { type: "string" },
            redirect_to: { type: "string" },
          },
        },
      },
    },
    asyncHandler(async (req, reply) => {
      const { database } = req.params as { database: string };
      const { token, redirect_to: redirectTo } = req.query as {
        token: string;
        redirect_to?: string;
      };

      const sql = server.poolManager.getPool(database);
      await ensureAuthSchema(sql);

      const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

      const [user] = await sql`
        SELECT id, email, role, is_active, created_at, metadata, provider, full_name, avatar_url,
               metadata->>'magic_token_exp' AS magic_token_exp
        FROM _postgrify_auth.users
        WHERE metadata->>'magic_token' = ${tokenHash}
      `;

      if (!user) {
        return reply.status(400).send({ error: "Invalid or already used magic link token" });
      }

      const rawExp = user.magic_token_exp as string | null | undefined;
      if (!rawExp) {
        return reply.status(400).send({ error: "Invalid or expired magic link token" });
      }
      const exp = new Date(rawExp);
      if (isNaN(exp.getTime()) || exp < new Date()) {
        return reply.status(400).send({ error: "Magic link token has expired" });
      }

      if (!user.is_active) {
        return reply.status(403).send({ error: "Account is disabled" });
      }

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
      const refreshTokenHash = crypto.createHash("sha256").update(refreshToken).digest("hex");
      const expiresAt = new Date(Date.now() + parseDurationMs(config.REFRESH_TOKEN_EXPIRY));

      await sql`
        INSERT INTO _postgrify_auth.sessions (user_id, refresh_token, expires_at, ip, user_agent)
        VALUES (${user.id}, ${refreshTokenHash}, ${expiresAt.toISOString()}, ${req.ip}, ${req.headers["user-agent"] ?? null})
      `;

      await insertAuditLog(sql, "magic_link_login", user.id as string, {
        ip: req.ip,
        userAgent: req.headers["user-agent"],
      });

      const meta =
        user.metadata && typeof user.metadata === "object"
          ? { ...(user.metadata as Record<string, unknown>) }
          : {};
      delete meta.magic_token;
      delete meta.magic_token_exp;

      const session = buildSessionResponse({
        accessToken,
        refreshToken,
        user: {
          id: user.id as string,
          email: user.email as string,
          role: user.role as string,
          is_active: user.is_active as boolean,
          email_verified: true,
          created_at: user.created_at as string | Date | null,
          metadata: meta,
          provider: (user.provider as string) ?? "email",
          full_name: user.full_name as string | null,
          avatar_url: user.avatar_url as string | null,
        },
      });

      if (redirectTo) {
        const base = safeAppRedirect(redirectTo);
        const fragment = sessionFragment({
          accessToken: session.access_token,
          refreshToken: session.refresh_token ?? "",
          expiresIn: session.expires_in,
          expiresAt: session.expires_at,
          type: "magiclink",
        });
        return reply.redirect(`${base}#${fragment}`);
      }

      return reply.send(session);
    })
  );
}
