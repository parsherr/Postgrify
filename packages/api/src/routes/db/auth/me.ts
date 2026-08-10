/**
 * GET    /:database/auth/me — Geçerli DB kullanıcısının bilgilerini döner.
 * PATCH  /:database/auth/me — Profil alanlarını günceller (full_name, avatar_url, metadata).
 *
 * Her iki endpoint de Authorization: Bearer <db-user-access-token> gerektirir.
 * password_hash hiçbir zaman döndürülmez.
 * Şifre değişikliği için PATCH /:database/auth/me/password kullanılır.
 * Hesap silme için DELETE /:database/auth/me (users.ts içinde tanımlı).
 */

import type { FastifyInstance } from "fastify";
import { asyncHandler } from "../../../utils/asyncHandler.js";
import { ensureAuthSchema, insertAuditLog } from "./provision.js";
import { JwtService } from "../../../services/jwtService.js";
import { config } from "../../../config/env.js";

export async function authMeRoute(server: FastifyInstance) {
  const jwtService = new JwtService(() => config.JWT_SECRET);

  server.get(
    "/:database/auth/me",
    {
      config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
      schema: {
        description: "Get current DB user profile from access token.",
        tags: ["db-auth"],
        security: [{ bearerAuth: [] }],
        response: {
          200: {
            type: "object",
            properties: {
              id:             { type: "string" },
              email:          { type: "string" },
              role:           { type: "string" },
              full_name:      { type: ["string", "null"] },
              avatar_url:     { type: ["string", "null"] },
              email_verified: { type: "boolean" },
              is_active:      { type: "boolean" },
              provider:       { type: "string" },
              created_at:     { type: "string" },
              last_login:     { type: ["string", "null"] },
              // metadata dinamik key'ler içerebilir — serializasyon sırasında kırpılmasın
              metadata:       { type: "object", additionalProperties: true },
            },
          },
        },
      },
    },
    asyncHandler(async (req, reply) => {
      const { database } = req.params as { database: string };

      const auth = req.headers.authorization;
      if (!auth?.startsWith("Bearer ")) {
        return reply.status(401).send({ error: "Missing authorization token" });
      }

      const payload = await jwtService.verifyDbUser(auth.slice(7));
      if (!payload) {
        return reply.status(401).send({ error: "Invalid or expired token" });
      }

      if (payload.db !== database) {
        return reply.status(403).send({ error: "Token database mismatch" });
      }

      const sql = server.poolManager.getPool(database);
      await ensureAuthSchema(sql);

      const [user] = await sql`
        SELECT
          id, email, role, full_name, avatar_url,
          email_verified, is_active, provider,
          created_at, last_login,
          -- Metadata array veya scalar olabilir (bozuk veri durumu) — önce object'e normalize et.
          (CASE WHEN jsonb_typeof(metadata) = 'object' THEN metadata ELSE '{}'::jsonb END)
            - 'verification_token' - 'verification_exp'
            - 'reset_token' - 'reset_token_exp'
            - 'magic_token' - 'magic_token_exp' AS metadata
        FROM _postgrify_auth.users
        WHERE id = ${payload.sub}
      `;

      if (!user) {
        return reply.status(404).send({ error: "User not found" });
      }

      return reply.send(user);
    })
  );

  // PATCH /:database/auth/me — profil güncelle
  server.patch(
    "/:database/auth/me",
    {
      config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
      schema: {
        description:
          "Update the current DB user's profile. " +
          "Only full_name, avatar_url, and metadata can be changed here. " +
          "Use PATCH /:database/auth/me/password for password changes.",
        tags: ["db-auth"],
        security: [{ bearerAuth: [] }],
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            full_name:  { type: ["string", "null"], maxLength: 255 },
            avatar_url: { type: ["string", "null"], maxLength: 2048 },
            // Metadata gönderilirse mevcut JSONB ile merge edilir (üstüne yazılmaz)
            metadata:   { type: "object" },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              id:             { type: "string" },
              email:          { type: "string" },
              role:           { type: "string" },
              full_name:      { type: ["string", "null"] },
              avatar_url:     { type: ["string", "null"] },
              email_verified: { type: "boolean" },
              is_active:      { type: "boolean" },
              provider:       { type: "string" },
              created_at:     { type: "string" },
              last_login:     { type: ["string", "null"] },
              // metadata dinamik key'ler içerebilir — serializasyon sırasında kırpılmasın
              metadata:       { type: "object", additionalProperties: true },
            },
          },
        },
      },
    },
    asyncHandler(async (req, reply) => {
      const { database } = req.params as { database: string };

      const auth = req.headers.authorization;
      if (!auth?.startsWith("Bearer ")) {
        return reply.status(401).send({ error: "Missing authorization token" });
      }

      const payload = await jwtService.verifyDbUser(auth.slice(7));
      if (!payload) {
        return reply.status(401).send({ error: "Invalid or expired token" });
      }

      if (payload.db !== database) {
        return reply.status(403).send({ error: "Token database mismatch" });
      }

      const body = req.body as {
        full_name?: string | null;
        avatar_url?: string | null;
        metadata?: Record<string, unknown>;
      };

      if (!body || Object.keys(body).length === 0) {
        return reply.status(400).send({ error: "Request body is empty — nothing to update" });
      }

      const sql = server.poolManager.getPool(database);
      await ensureAuthSchema(sql);

      // "full_name" veya "avatar_url" body'de varsa (undefined değil) güncelle,
      // yoksa mevcut değeri koru. null göndermek alanı temizler.
      // Metadata varsa mevcut JSONB ile merge et — ama hassas alanlar korunur.
      const hasFullName  = "full_name"  in body;
      const hasAvatarUrl = "avatar_url" in body;
      const hasMetadata  = "metadata"   in body;

      // Güvenlik: kullanıcı metadata merge ile token/auth alanlarını overwrite edemez.
      // Saldırı örneği: {"reset_token":"evil_hash"} → DB'deki gerçek reset token override.
      // Çözüm: merge SONRASI hassas alanları DB JSONB - operatörüyle sil.
      const PROTECTED_METADATA_KEYS = [
        "reset_token", "reset_token_exp",
        "magic_token", "magic_token_exp",
        "verification_token", "verification_exp",
      ];

      // Sanitize: body.metadata'dan korunan alanları kaldır
      let safeMetadata: Record<string, unknown> = {};
      if (hasMetadata && body.metadata) {
        safeMetadata = { ...body.metadata };
        for (const key of PROTECTED_METADATA_KEYS) {
          delete safeMetadata[key];
        }
      }

      const [updated] = await sql`
        UPDATE _postgrify_auth.users
        SET
          full_name  = ${hasFullName  ? (body.full_name  ?? null) : sql`full_name`},
          avatar_url = ${hasAvatarUrl ? (body.avatar_url ?? null) : sql`avatar_url`},
          metadata   = ${hasMetadata
            ? sql`((CASE WHEN jsonb_typeof(metadata) = 'object' THEN metadata ELSE '{}'::jsonb END)
                  || ${JSON.stringify(safeMetadata)}::text::jsonb)
                  - 'reset_token' - 'reset_token_exp'
                  - 'magic_token' - 'magic_token_exp'
                  - 'verification_token' - 'verification_exp'`
            : sql`metadata`}
        WHERE id = ${payload.sub}
        RETURNING
          id, email, role, full_name, avatar_url,
          email_verified, is_active, provider,
          created_at, last_login,
          (CASE WHEN jsonb_typeof(metadata) = 'object' THEN metadata ELSE '{}'::jsonb END)
            - 'verification_token' - 'verification_exp'
            - 'reset_token' - 'reset_token_exp'
            - 'magic_token' - 'magic_token_exp' AS metadata
      `;

      if (!updated) {
        return reply.status(404).send({ error: "User not found" });
      }

      return reply.send(updated);
    })
  );

  }