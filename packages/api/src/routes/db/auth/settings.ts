/**
 * Per-DB auth ayarları:
 *
 *   GET  /:database/auth/settings           — tüm ayarları getir
 *   PUT  /:database/auth/settings           — ayarları güncelle
 *   GET  /:database/auth/settings/oauth     — OAuth provider listesi
 *   POST /:database/auth/settings/oauth     — OAuth provider ekle/güncelle
 *   DELETE /:database/auth/settings/oauth/:provider — OAuth provider sil
 *
 * Tüm ayar endpoint'leri admin scope gerektirir.
 */

import type { FastifyInstance } from "fastify";
import { asyncHandler } from "../../../utils/asyncHandler.js";
import { scopeGuard } from "../../../middleware/scopeGuard.js";
import { ensureAuthSchema } from "./provision.js";

const AUTH_SETTING_KEYS = [
  "email_signup_enabled",
  "magic_link_enabled",
  "email_verify_required",
  "oauth_enabled",
  "signup_redirect_url",
  "token_expiry",
  "refresh_token_expiry",
] as const;

type AuthSettingKey = (typeof AUTH_SETTING_KEYS)[number];

const adminGuard = (server: FastifyInstance) =>
  [server.authenticate, scopeGuard("schema")] as const;

export async function authSettingsRoute(server: FastifyInstance) {
  // ── GET /:database/auth/settings ────────────────────────────────────────
  server.get(
    "/:database/auth/settings",
    {
      preHandler: [...adminGuard(server)],
      schema: {
        description: "Get all auth settings for this database.",
        tags: ["db-auth"],
        security: [{ bearerAuth: [] }],
      },
    },
    asyncHandler(async (req, reply) => {
      const sql = server.poolManager.getPool(req.dbName!);
      await ensureAuthSchema(sql);

      const rows = await sql`
        SELECT key, value FROM _postgrify_auth.auth_settings
        ORDER BY key
      `;

      const settings = Object.fromEntries(rows.map((r) => [r.key, r.value]));
      return reply.send(settings);
    })
  );

  // ── PUT /:database/auth/settings ────────────────────────────────────────
  server.put(
    "/:database/auth/settings",
    {
      preHandler: [...adminGuard(server)],
      schema: {
        description: "Update auth settings. Only known keys are accepted.",
        tags: ["db-auth"],
        security: [{ bearerAuth: [] }],
        body: {
          type: "object",
          properties: {
            email_signup_enabled:  { type: "string", enum: ["true", "false"] },
            magic_link_enabled:    { type: "string", enum: ["true", "false"] },
            email_verify_required: { type: "string", enum: ["true", "false"] },
            oauth_enabled:         { type: "string", enum: ["true", "false"] },
            signup_redirect_url:   { type: "string" },
            token_expiry:          { type: "string", pattern: "^\\d+[smhd]$" },
            refresh_token_expiry:  { type: "string", pattern: "^\\d+[smhd]$" },
          },
          additionalProperties: false,
        },
      },
    },
    asyncHandler(async (req, reply) => {
      const body = req.body as Partial<Record<AuthSettingKey, string>>;
      const sql = server.poolManager.getPool(req.dbName!);
      await ensureAuthSchema(sql);

      for (const [key, value] of Object.entries(body)) {
        if (!AUTH_SETTING_KEYS.includes(key as AuthSettingKey)) continue;
        await sql`
          INSERT INTO _postgrify_auth.auth_settings (key, value, updated_at)
          VALUES (${key}, ${value!}, now())
          ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
        `;
      }

      const rows = await sql`
        SELECT key, value FROM _postgrify_auth.auth_settings ORDER BY key
      `;
      return reply.send(Object.fromEntries(rows.map((r) => [r.key, r.value])));
    })
  );

  // ── GET /:database/auth/settings/oauth ──────────────────────────────────
  server.get(
    "/:database/auth/settings/oauth",
    {
      preHandler: [...adminGuard(server)],
      schema: {
        description: "List configured OAuth providers (client_secret redacted).",
        tags: ["db-auth"],
        security: [{ bearerAuth: [] }],
      },
    },
    asyncHandler(async (req, reply) => {
      const sql = server.poolManager.getPool(req.dbName!);
      await ensureAuthSchema(sql);

      const rows = await sql`
        SELECT id, provider, client_id, redirect_uri, enabled, created_at
        FROM _postgrify_auth.oauth_providers
        ORDER BY provider
      `;

      return reply.send(rows);
    })
  );

  // ── POST /:database/auth/settings/oauth ─────────────────────────────────
  server.post(
    "/:database/auth/settings/oauth",
    {
      preHandler: [...adminGuard(server)],
      schema: {
        description: "Add or update an OAuth provider configuration.",
        tags: ["db-auth"],
        security: [{ bearerAuth: [] }],
        body: {
          type: "object",
          required: ["provider", "client_id", "client_secret", "redirect_uri"],
          properties: {
            provider:      { type: "string", enum: ["google", "github"] },
            client_id:     { type: "string", minLength: 1 },
            client_secret: { type: "string", minLength: 1 },
            redirect_uri:  { type: "string", minLength: 1 },
            enabled:       { type: "boolean" },
          },
        },
      },
    },
    asyncHandler(async (req, reply) => {
      const { provider, client_id, client_secret, redirect_uri, enabled = true } =
        req.body as {
          provider: "google" | "github";
          client_id: string;
          client_secret: string;
          redirect_uri: string;
          enabled?: boolean;
        };

      const sql = server.poolManager.getPool(req.dbName!);
      await ensureAuthSchema(sql);

      const [row] = await sql`
        INSERT INTO _postgrify_auth.oauth_providers
          (provider, client_id, client_secret, redirect_uri, enabled)
        VALUES
          (${provider}, ${client_id}, ${client_secret}, ${redirect_uri}, ${enabled})
        ON CONFLICT (provider) DO UPDATE SET
          client_id     = EXCLUDED.client_id,
          client_secret = EXCLUDED.client_secret,
          redirect_uri  = EXCLUDED.redirect_uri,
          enabled       = EXCLUDED.enabled
        RETURNING id, provider, client_id, redirect_uri, enabled, created_at
      `;

      // oauth_enabled'ı otomatik true yap
      await sql`
        INSERT INTO _postgrify_auth.auth_settings (key, value, updated_at)
        VALUES ('oauth_enabled', 'true', now())
        ON CONFLICT (key) DO UPDATE SET value = 'true', updated_at = now()
      `;

      return reply.status(201).send(row);
    })
  );

  // ── DELETE /:database/auth/settings/oauth/:provider ─────────────────────
  server.delete(
    "/:database/auth/settings/oauth/:provider",
    {
      preHandler: [...adminGuard(server)],
      schema: {
        description: "Remove an OAuth provider configuration.",
        tags: ["db-auth"],
        security: [{ bearerAuth: [] }],
      },
    },
    asyncHandler(async (req, reply) => {
      const { provider } = req.params as { provider: string };
      const sql = server.poolManager.getPool(req.dbName!);
      await ensureAuthSchema(sql);

      await sql`
        DELETE FROM _postgrify_auth.oauth_providers WHERE provider = ${provider}
      `;

      return reply.status(204).send();
    })
  );
}