/**
 * GET /:database/auth/verify?token= — Email adresini doğrula.
 *
 * Token metadata'dan okunur, geçerliyse email_verified=true yapılır.
 * Başarılı doğrulama sonrası otomatik session oluşturulur (kullanıcı
 * hemen giriş yapmış olur).
 */

import type { FastifyInstance } from "fastify";
import { asyncHandler } from "../../../utils/asyncHandler.js";
import { ensureAuthSchema, insertAuditLog } from "./provision.js";
import { JwtService } from "../../../services/jwtService.js";
import { config } from "../../../config/env.js";
import crypto from "node:crypto";

/**
 * Gelen plain-text token'ı SHA-256 ile hash'ler.
 * Signup sırasında hash saklanır; doğrulama sırasında hash karşılaştırılır.
 * Bu sayede DB dump'ı veya admin API sızıntısında ham token kullanılamaz.
 */
function hashVerificationToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export async function authVerifyRoute(server: FastifyInstance) {
  const jwtService = new JwtService(() => config.JWT_SECRET);

  server.get(
    "/:database/auth/verify",
    {
      schema: {
        description: "Verify email address via token. Returns a session on success.",
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
              ok:           { type: "boolean" },
              accessToken:  { type: "string" },
              refreshToken: { type: "string" },
              expiresIn:    { type: "string" },
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

      // Gelen token'ı hash'leyip DB'deki hash ile karşılaştır.
      // DB'de plain text token saklanmaz — yalnızca SHA-256 hash'i tutulur.
      const tokenHash = hashVerificationToken(token);

      const [user] = await sql`
        SELECT id, email, role, is_active,
               metadata->>'verification_exp' AS verification_exp
        FROM _postgrify_auth.users
        WHERE metadata->>'verification_token' = ${tokenHash}
          AND email_verified = false
      `;

      if (!user) {
        return reply.status(400).send({ error: "Invalid or already used verification token" });
      }

      // Savunma: verification_exp NULL veya parse edilemezse token geçersiz say.
      // new Date(undefined) = Invalid Date → exp < new Date() = false → token geçerli sayılabilir!
      const rawExp = user.verification_exp as string | null | undefined;
      if (!rawExp) {
        return reply.status(400).send({ error: "Invalid or expired verification token" });
      }
      const exp = new Date(rawExp);
      if (isNaN(exp.getTime()) || exp < new Date()) {
        return reply.status(400).send({ error: "Verification token has expired" });
      }

      if (!user.is_active) {
        return reply.status(403).send({ error: "Account is disabled" });
      }

      // email_verified = true yap, token'ı temizle
      await sql`
        UPDATE _postgrify_auth.users
        SET
          email_verified = true,
          last_login     = now(),
          metadata       = metadata
            - 'verification_token'
            - 'verification_exp'
        WHERE id = ${user.id}
      `;

      // Otomatik session oluştur
      const accessToken = await jwtService.signDbUserToken(
        database,
        user.id as string,
        user.email as string,
        user.role as string,
        config.ACCESS_TOKEN_EXPIRY
      );

      // Yeni session — DB'de refresh token hash'ini sakla, client'a ham token gönder
      const refreshToken = crypto.randomBytes(48).toString("hex");
      const refreshTokenHash = crypto.createHash("sha256").update(refreshToken).digest("hex");
      const expiresAt = new Date(Date.now() + parseDuration(config.REFRESH_TOKEN_EXPIRY));

      await sql`
        INSERT INTO _postgrify_auth.sessions (user_id, refresh_token, expires_at, ip, user_agent)
        VALUES (${user.id}, ${refreshTokenHash}, ${expiresAt.toISOString()}, ${req.ip}, ${req.headers["user-agent"] ?? null})
      `;

      await insertAuditLog(sql, "email_verified", user.id as string, {
        ip: req.ip,
        userAgent: req.headers["user-agent"],
      });

      return reply.send({
        ok: true,
        accessToken,
        refreshToken,
        expiresIn: config.ACCESS_TOKEN_EXPIRY,
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