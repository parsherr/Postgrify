/**
 * DB Auth Token routes — email+şifre ile login, JWT üretimi ve logout.
 *
 *   POST /:database/auth/login   — kimlik doğrula, accessToken + refreshToken döner
 *   POST /:database/auth/logout  — refresh token revoke et
 *   POST /:database/auth/refresh — yeni access token al
 *
 * Bu endpoint'ler authenticate preHandler gerektirmez — public.
 * Rate limit: 10 req/dk (brute-force koruması).
 */

import type { FastifyInstance } from "fastify";
import { asyncHandler } from "../../../utils/asyncHandler.js";
import { verifyPassword } from "../../../services/passwordService.js";
import { JwtService } from "../../../services/jwtService.js";
import { config } from "../../../config/env.js";
import { ensureAuthSchema, insertAuditLog, getAuthSetting } from "./provision.js";
import crypto from "node:crypto";

const RATE_LIMIT = { max: 10, timeWindow: "1 minute" } as const;

export async function authTokensRoute(server: FastifyInstance) {
  const jwtService = new JwtService(config.JWT_SECRET);

  // ── POST /:database/auth/login ────────────────────────────────────────────
  server.post(
    "/:database/auth/login",
    {
      config: { rateLimit: RATE_LIMIT },
      schema: {
        description: "Login with email + password, returns access token and refresh token",
        tags: ["db-auth"],
        security: [],
        body: {
          type: "object",
          required: ["email", "password"],
          properties: {
            email:    { type: "string", format: "email" },
            password: { type: "string", minLength: 1 },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              accessToken:  { type: "string" },
              refreshToken: { type: ["string", "null"] },
              expiresIn:    { type: "string" },
              user: {
                type: "object",
                properties: {
                  id:        { type: "string" },
                  email:     { type: "string" },
                  role:      { type: "string" },
                  is_active: { type: "boolean" },
                },
              },
            },
          },
        },
      },
    },
    asyncHandler(async (req, reply) => {
      const { database } = req.params as { database: string };
      const { email, password } = req.body as { email: string; password: string };

      const sql = server.poolManager.getPool(database);
      await ensureAuthSchema(sql);

      // Kullanıcıyı bul (hash dahil — sadece bu sorguda)
      const [user] = await sql`
        SELECT id, email, password_hash, role, is_active
        FROM _postgrify_auth.users
        WHERE email = ${email.toLowerCase()}
      `;

      if (!user) {
        // Timing-safe: kullanıcı yoksa da hash verify maliyetini simüle et
        await verifyPassword(
          "$argon2id$v=19$m=65536,t=3,p=4$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
          password
        );
        await insertAuditLog(sql, "login_failed", null, {
          ip: req.ip,
          userAgent: req.headers["user-agent"],
          metadata: { email, reason: "user_not_found" },
        });
        return reply.status(401).send({ error: "Invalid credentials" });
      }

      if (!user.is_active) {
        await insertAuditLog(sql, "account_disabled", user.id as string, {
          ip: req.ip,
          userAgent: req.headers["user-agent"],
        });
        return reply.status(403).send({ error: "Account is disabled" });
      }

      // email_verify_required kontrolü
      const verifyRequired = await getAuthSetting(sql, "email_verify_required", "false");
      if (verifyRequired === "true" && !user.email_verified) {
        return reply.status(403).send({
          error: "Email not verified",
          message: "Please verify your email address before signing in.",
        });
      }

      const valid = await verifyPassword(user.password_hash as string, password);
      if (!valid) {
        await insertAuditLog(sql, "login_failed", user.id as string, {
          ip: req.ip,
          userAgent: req.headers["user-agent"],
          metadata: { reason: "wrong_password" },
        });
        return reply.status(401).send({ error: "Invalid credentials" });
      }

      // last_login güncelle + audit log
      await sql`
        UPDATE _postgrify_auth.users
        SET last_login = now()
        WHERE id = ${user.id}
      `;

      await insertAuditLog(sql, "login", user.id as string, {
        ip: req.ip,
        userAgent: req.headers["user-agent"],
      });

      // Access token — DB-user scoped
      const accessToken = await jwtService.signDbUserToken(
        database,
        user.id as string,
        user.email as string,
        user.role as string,
        config.ACCESS_TOKEN_EXPIRY
      );

      // Refresh token — DB'ye kaydet
      const refreshToken = crypto.randomBytes(48).toString("hex");
      const expiresAt = new Date(Date.now() + parseDuration(config.REFRESH_TOKEN_EXPIRY));

      await sql`
        INSERT INTO _postgrify_auth.sessions (user_id, refresh_token, expires_at)
        VALUES (${user.id}, ${refreshToken}, ${expiresAt.toISOString()})
      `;

      return reply.send({
        accessToken,
        refreshToken,
        expiresIn: config.ACCESS_TOKEN_EXPIRY,
        user: {
          id:        user.id,
          email:     user.email,
          role:      user.role,
          is_active: user.is_active,
        },
      });
    })
  );

  // ── POST /:database/auth/refresh ──────────────────────────────────────────
  server.post(
    "/:database/auth/refresh",
    {
      config: { rateLimit: RATE_LIMIT },
      schema: {
        description: "Exchange a refresh token for a new access token",
        tags: ["db-auth"],
        security: [],
        body: {
          type: "object",
          required: ["refreshToken"],
          properties: {
            refreshToken: { type: "string" },
          },
        },
      },
    },
    asyncHandler(async (req, reply) => {
      const { database } = req.params as { database: string };
      const { refreshToken } = req.body as { refreshToken: string };

      const sql = server.poolManager.getPool(database);
      await ensureAuthSchema(sql);

      // Refresh token'ı bul ve geçerliliğini kontrol et
      const [session] = await sql`
        SELECT s.id, s.user_id, s.expires_at,
               u.email, u.role, u.is_active
        FROM _postgrify_auth.sessions s
        JOIN _postgrify_auth.users u ON u.id = s.user_id
        WHERE s.refresh_token = ${refreshToken}
          AND s.revoked = false
          AND s.expires_at > now()
      `;

      if (!session) {
        return reply.status(401).send({ error: "Invalid or expired refresh token" });
      }

      if (!session.is_active) {
        return reply.status(403).send({ error: "Account is disabled" });
      }

      // Eski token'ı revoke et (token rotation)
      await sql`
        UPDATE _postgrify_auth.sessions
        SET revoked = true
        WHERE id = ${session.id}
      `;

      // Yeni refresh token üret
      const newRefreshToken = crypto.randomBytes(48).toString("hex");
      const expiresAt = new Date(Date.now() + parseDuration(config.REFRESH_TOKEN_EXPIRY));

      await sql`
        INSERT INTO _postgrify_auth.sessions (user_id, refresh_token, expires_at)
        VALUES (${session.user_id}, ${newRefreshToken}, ${expiresAt.toISOString()})
      `;

      // Yeni access token
      const accessToken = await jwtService.signDbUserToken(
        database,
        session.user_id as string,
        session.email as string,
        session.role as string,
        config.ACCESS_TOKEN_EXPIRY
      );

      return reply.send({
        accessToken,
        refreshToken: newRefreshToken,
        expiresIn: config.ACCESS_TOKEN_EXPIRY,
      });
    })
  );

  // ── POST /:database/auth/logout ───────────────────────────────────────────
  server.post(
    "/:database/auth/logout",
    {
      schema: {
        description: "Revoke a refresh token (logout)",
        tags: ["db-auth"],
        security: [],
        body: {
          type: "object",
          required: ["refreshToken"],
          properties: {
            refreshToken: { type: "string" },
          },
        },
      },
    },
    asyncHandler(async (req, reply) => {
      const { database } = req.params as { database: string };
      const { refreshToken } = req.body as { refreshToken: string };

      const sql = server.poolManager.getPool(database);
      await ensureAuthSchema(sql);

      await sql`
        UPDATE _postgrify_auth.sessions
        SET revoked = true
        WHERE refresh_token = ${refreshToken}
      `;

      // Logout audit log (session'dan user_id bul)
      const [session] = await sql`
        SELECT user_id FROM _postgrify_auth.sessions
        WHERE refresh_token = ${refreshToken}
      `;
      if (session) {
        await insertAuditLog(sql, "logout", session.user_id as string, {
          ip: req.ip,
          userAgent: req.headers["user-agent"],
        });
      }

      return reply.status(204).send();
    })
  );
}

/**
 * "15m", "7d", "24h" gibi expiry string'ini milisaniyeye çevirir.
 */
function parseDuration(expiry: string): number {
  const match = expiry.match(/^(\d+)([smhd])$/);
  if (!match) return 7 * 24 * 60 * 60 * 1000; // default 7 days

  const value = parseInt(match[1], 10);
  const unit = match[2];
  const multipliers: Record<string, number> = {
    s: 1_000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
  };
  return value * (multipliers[unit] ?? 86_400_000);
}