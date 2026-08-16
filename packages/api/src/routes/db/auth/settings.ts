/**
 * Per-DB auth ayarları:
 *
 *   GET  /:database/auth/settings           — public GoTrue shape; admin+schema → full
 *   PUT  /:database/auth/settings           — ayarları güncelle (schema)
 *   GET  /:database/auth/settings/oauth     — OAuth provider listesi
 *   POST /:database/auth/settings/oauth     — OAuth provider ekle/güncelle
 *   DELETE /:database/auth/settings/oauth/:provider — OAuth provider sil
 *
 * C-20: GET is public (apiKey still required via group hook). With admin/schema
 * Bearer, response includes full settings plus typed aliases for the GUI.
 */

import type { FastifyInstance, FastifyRequest } from "fastify";
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
  // Yeni kayıt olan kullanıcıların varsayılan rolü (SORUN #7 düzeltmesi).
  // Değerler: 'viewer' | 'editor' | 'admin'
  "default_user_role",
] as const;

type AuthSettingKey = (typeof AUTH_SETTING_KEYS)[number];

const BOOL_SETTING_KEYS = new Set([
  "email_signup_enabled",
  "magic_link_enabled",
  "email_verify_required",
  "oauth_enabled",
]);

const adminGuard = (server: FastifyInstance) =>
  [server.authenticate, scopeGuard("schema")] as const;

function asBool(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) return defaultValue;
  return value.toLowerCase() === "true";
}

async function loadSettingMap(
  sql: ReturnType<FastifyInstance["poolManager"]["getPool"]>
): Promise<Record<string, string>> {
  const rows = await sql`
    SELECT key, value FROM _postgrify_auth.auth_settings
    ORDER BY key
  `;
  return Object.fromEntries(rows.map((r) => [r.key as string, r.value as string]));
}

async function loadOAuthFlags(
  sql: ReturnType<FastifyInstance["poolManager"]["getPool"]>
): Promise<{ google: boolean; github: boolean }> {
  const rows = await sql`
    SELECT provider, enabled
    FROM _postgrify_auth.oauth_providers
  `;
  let google = false;
  let github = false;
  for (const row of rows) {
    if (row.provider === "google" && row.enabled) google = true;
    if (row.provider === "github" && row.enabled) github = true;
  }
  return { google, github };
}

function buildPublicSettings(
  settings: Record<string, string>,
  oauth: { google: boolean; github: boolean }
) {
  const emailEnabled = asBool(settings.email_signup_enabled, true);
  const magicLink = asBool(settings.magic_link_enabled, false);
  const verifyRequired = asBool(settings.email_verify_required, false);

  return {
    external: {
      email: emailEnabled,
      google: oauth.google,
      github: oauth.github,
      apple: false,
      phone: false,
      magic_link: magicLink,
    },
    disable_signup: !emailEnabled,
    mailer_autoconfirm: !verifyRequired,
    phone_autoconfirm: false,
    sms_provider: "",
  };
}

function buildAdminSettings(
  settings: Record<string, string>,
  oauth: { google: boolean; github: boolean }
) {
  const publicShape = buildPublicSettings(settings, oauth);

  // Flat keys stay strings for GUI (AuthsTab compares === "true").
  // Typed GoTrue aliases are added alongside.
  const typed: Record<string, unknown> = { ...settings };
  for (const key of BOOL_SETTING_KEYS) {
    if (settings[key] !== undefined) {
      typed[`${key}_bool`] = asBool(settings[key], false);
    }
  }

  return {
    ...typed,
    ...publicShape,
  };
}

async function requesterHasSchemaAccess(
  server: FastifyInstance,
  req: FastifyRequest
): Promise<boolean> {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) return false;
  const payload = await server.jwtService.verifyAdminOrDb(auth.slice(7));
  if (!payload) return false;
  if (payload.role === "admin") return true;
  if (payload.sub === req.dbName && payload.scope?.includes("schema")) {
    return true;
  }
  return false;
}

export async function authSettingsRoute(server: FastifyInstance) {
  // ── GET /:database/auth/settings (C-20 public + admin enrich) ───────────
  server.get(
    "/:database/auth/settings",
    {
      schema: {
        description:
          "Public GoTrue-style auth settings (C-20). With admin/schema Bearer, also returns full flat settings for the admin GUI.",
        tags: ["db-auth"],
      },
    },
    asyncHandler(async (req, reply) => {
      const sql = server.poolManager.getPool(req.dbName!);
      await ensureAuthSchema(sql);

      const settings = await loadSettingMap(sql);
      const oauth = await loadOAuthFlags(sql);

      if (await requesterHasSchemaAccess(server, req)) {
        return reply.send(buildAdminSettings(settings, oauth));
      }
      return reply.send(buildPublicSettings(settings, oauth));
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
            email_signup_enabled: { type: "string", enum: ["true", "false"] },
            magic_link_enabled: { type: "string", enum: ["true", "false"] },
            email_verify_required: { type: "string", enum: ["true", "false"] },
            oauth_enabled: { type: "string", enum: ["true", "false"] },
            signup_redirect_url: { type: "string" },
            token_expiry: { type: "string", pattern: "^\\d+[smhd]$" },
            refresh_token_expiry: { type: "string", pattern: "^\\d+[smhd]$" },
            // Yeni kullanıcıların varsayılan rolü (SORUN #7 düzeltmesi)
            default_user_role: { type: "string", enum: ["viewer", "editor", "admin"] },
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

        // Güvenlik: signup_redirect_url için URL format doğrulaması.
        // Geçersiz veya tehlikeli protokol (javascript:, data:) içeren URL'ler reddedilir.
        // Bu, oauth.ts callback'teki origin whitelist'e ek olarak savunma derinliği sağlar.
        if (key === "signup_redirect_url" && value) {
          let parsedUrl: URL;
          try {
            parsedUrl = new URL(value);
          } catch {
            return reply.status(400).send({
              error: "Invalid signup_redirect_url: must be a valid URL",
            });
          }
          const allowedProtocols = ["http:", "https:"];
          if (!allowedProtocols.includes(parsedUrl.protocol)) {
            return reply.status(400).send({
              error: "Invalid signup_redirect_url: only http: and https: protocols are allowed",
            });
          }
        }

        await sql`
          INSERT INTO _postgrify_auth.auth_settings (key, value, updated_at)
          VALUES (${key}, ${value!}, now())
          ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
        `;
      }

      const settings = await loadSettingMap(sql);
      const oauth = await loadOAuthFlags(sql);
      return reply.send(buildAdminSettings(settings, oauth));
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
            provider: { type: "string", enum: ["google", "github"] },
            client_id: { type: "string", minLength: 1 },
            client_secret: { type: "string", minLength: 1 },
            redirect_uri: { type: "string", minLength: 1 },
            enabled: { type: "boolean" },
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
