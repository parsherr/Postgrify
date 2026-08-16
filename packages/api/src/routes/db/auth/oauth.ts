/**
 * OAuth flow:
 *
 *   GET /:database/auth/oauth/:provider           — provider'a redirect
 *   GET /:database/auth/oauth/:provider/callback  — code exchange, session oluştur
 *
 * State parametresi CSRF koruması için kullanılır (opaque token, session'a bağlı).
 * Provider config DB'den okunur (_postgrify_auth.oauth_providers).
 */

import type { FastifyInstance } from "fastify";
import { asyncHandler } from "../../../utils/asyncHandler.js";
import { ensureAuthSchema, insertAuditLog, getAuthSetting } from "./provision.js";
import { getAuthUrl, exchangeCode } from "../../../services/oauthService.js";
import { JwtService } from "../../../services/jwtService.js";
import { config } from "../../../config/env.js";
import { expirySeconds, parseDurationMs } from "./sessionResponse.js";
import { safeAppRedirect, sessionFragment } from "./redirectSafe.js";
import crypto from "node:crypto";

/**
 * OAuth CSRF state store.
 *
 * Redis varsa: state'ler Redis'te TTL ile saklanır — restart ve multi-instance'ta kalıcı.
 * Redis yoksa: in-memory Map fallback — tek instance, restart'ta sıfırlanır.
 *
 * State değeri JSON string olarak saklanır: { database, provider, exp }
 */

const STATE_TTL_SECONDS = 10 * 60; // 10 dakika

interface OAuthState {
  database: string;
  provider: string;
  exp: number;
}

async function stateSet(
  redisClient: import("ioredis").Redis | null,
  memStore: Map<string, OAuthState>,
  key: string,
  value: OAuthState
): Promise<void> {
  if (redisClient) {
    await redisClient.set(`oauth:state:${key}`, JSON.stringify(value), "EX", STATE_TTL_SECONDS);
  } else {
    memStore.set(key, value);
  }
}

async function stateGet(
  redisClient: import("ioredis").Redis | null,
  memStore: Map<string, OAuthState>,
  key: string
): Promise<OAuthState | null> {
  if (redisClient) {
    const raw = await redisClient.get(`oauth:state:${key}`);
    if (!raw) return null;
    return JSON.parse(raw) as OAuthState;
  }
  const entry = memStore.get(key);
  if (!entry || entry.exp < Date.now()) {
    memStore.delete(key);
    return null;
  }
  return entry;
}

async function stateDel(
  redisClient: import("ioredis").Redis | null,
  memStore: Map<string, OAuthState>,
  key: string
): Promise<void> {
  if (redisClient) {
    await redisClient.del(`oauth:state:${key}`);
  } else {
    memStore.delete(key);
  }
}

// In-memory fallback (Redis yoksa)
const memStateStore = new Map<string, OAuthState>();

// In-memory TTL temizliği
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of memStateStore) {
    if (val.exp < now) memStateStore.delete(key);
  }
}, 5 * 60 * 1000);

export async function authOAuthRoute(server: FastifyInstance) {
  const jwtService = new JwtService(() => config.JWT_SECRET);

  // Redis client — state store için (varsa).
  // Redis yoksa memStateStore fallback kullanılır.
  let redisClient: import("ioredis").Redis | null = null;
  if (config.REDIS_URL) {
    try {
      const { Redis } = await import("ioredis");
      redisClient = new Redis(config.REDIS_URL, {
        maxRetriesPerRequest: 1,
        enableReadyCheck: false,
        connectTimeout: 5_000,
      });
      redisClient.on("error", (err: Error) =>
        server.log.warn(`[oauth] Redis state store error: ${err.message}`)
      );
      server.log.info("[oauth] Using Redis-backed OAuth state store");
    } catch {
      server.log.warn("[oauth] Redis unavailable — using in-memory OAuth state store");
      redisClient = null;
    }
  }

  // ── GET /:database/auth/oauth/:provider ─────────────────────────────────
  server.get(
    "/:database/auth/oauth/:provider",
    {
      config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
      schema: {
        description: "Initiate OAuth flow. Redirects to provider.",
        tags: ["db-auth"],
        security: [],
        params: {
          type: "object",
          properties: {
            database: { type: "string" },
            provider: { type: "string", enum: ["google", "github"] },
          },
        },
      },
    },
    asyncHandler(async (req, reply) => {
      const { database, provider } = req.params as { database: string; provider: string };

      const sql = server.poolManager.getPool(database);
      await ensureAuthSchema(sql);

      const oauthEnabled = await getAuthSetting(sql, "oauth_enabled", "false");
      if (oauthEnabled !== "true") {
        return reply.status(403).send({
          error: "OAuth disabled",
          message: "OAuth sign-in is not enabled for this database.",
        });
      }

      // Provider config'i DB'den oku
      const [providerRow] = await sql`
        SELECT client_id, client_secret, redirect_uri
        FROM _postgrify_auth.oauth_providers
        WHERE provider = ${provider} AND enabled = true
      `;

      if (!providerRow) {
        return reply.status(404).send({ error: `OAuth provider '${provider}' not configured` });
      }

      // CSRF state üret
      const state = crypto.randomBytes(16).toString("hex");
      await stateSet(redisClient, memStateStore, state, {
        database, provider, exp: Date.now() + STATE_TTL_SECONDS * 1000,
      });

      const url = getAuthUrl(provider, {
        clientId:     providerRow.client_id as string,
        clientSecret: providerRow.client_secret as string,
        redirectUri:  providerRow.redirect_uri as string,
      }, state);

      return reply.redirect(url);
    })
  );

  // ── GET /:database/auth/oauth/:provider/callback ─────────────────────────
  server.get(
    "/:database/auth/oauth/:provider/callback",
    {
      schema: {
        description: "OAuth callback. Exchanges code for session and redirects.",
        tags: ["db-auth"],
        security: [],
        querystring: {
          type: "object",
          required: ["code", "state"],
          properties: {
            code:  { type: "string" },
            state: { type: "string" },
          },
        },
      },
    },
    asyncHandler(async (req, reply) => {
      const { database, provider } = req.params as { database: string; provider: string };
      const { code, state } = req.query as { code: string; state: string };

      // CSRF kontrolü — state Redis veya in-memory store'dan al, tek kullanımlık sil
      const stateData = await stateGet(redisClient, memStateStore, state);
      if (!stateData || stateData.database !== database || stateData.provider !== provider) {
        return reply.status(400).send({ error: "Invalid or expired OAuth state" });
      }
      await stateDel(redisClient, memStateStore, state);

      const sql = server.poolManager.getPool(database);
      await ensureAuthSchema(sql);

      // Provider config
      const [providerRow] = await sql`
        SELECT client_id, client_secret, redirect_uri
        FROM _postgrify_auth.oauth_providers
        WHERE provider = ${provider} AND enabled = true
      `;

      if (!providerRow) {
        return reply.status(404).send({ error: `OAuth provider '${provider}' not configured` });
      }

      // Code exchange
      let profile;
      try {
        profile = await exchangeCode(provider, code, {
          clientId:     providerRow.client_id as string,
          clientSecret: providerRow.client_secret as string,
          redirectUri:  providerRow.redirect_uri as string,
        });
      } catch (err) {
        server.log.warn({ err }, "OAuth code exchange failed");
        return reply.status(400).send({ error: "OAuth authentication failed" });
      }

      // Kullanıcıyı bul veya oluştur
      let [user] = await sql`
        SELECT id, email, role, is_active
        FROM _postgrify_auth.users
        WHERE (provider = ${provider} AND provider_id = ${profile.providerId})
           OR email = ${profile.email.toLowerCase()}
      `;

      let isNewUser = false;

      if (!user) {
        [user] = await sql`
          INSERT INTO _postgrify_auth.users
            (email, email_verified, provider, provider_id, full_name, avatar_url)
          VALUES
            (${profile.email.toLowerCase()}, true, ${provider}, ${profile.providerId},
             ${profile.fullName}, ${profile.avatarUrl})
          RETURNING id, email, role, is_active
        `;
        isNewUser = true;
      } else {
        // Mevcut kullanıcının OAuth bilgilerini güncelle
        await sql`
          UPDATE _postgrify_auth.users
          SET
            provider_id  = ${profile.providerId},
            provider     = ${provider},
            full_name    = COALESCE(full_name, ${profile.fullName}),
            avatar_url   = COALESCE(avatar_url, ${profile.avatarUrl}),
            last_login   = now()
          WHERE id = ${user.id}
        `;
      }

      if (!user.is_active) {
        return reply.status(403).send({ error: "Account is disabled" });
      }

      // Session oluştur
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

      await insertAuditLog(
        sql,
        isNewUser ? "oauth_signup" : "oauth_login",
        user.id as string,
        {
          ip: req.ip,
          userAgent: req.headers["user-agent"],
          metadata: { provider },
        }
      );

      // signup_redirect_url varsa oraya yönlendir (C-13 GoTrue fragment).
      const [redirectSetting] = await sql`
        SELECT value FROM _postgrify_auth.auth_settings
        WHERE key = 'signup_redirect_url'
      `;

      const rawRedirect =
        (redirectSetting?.value as string) || `${config.APP_URL}/auth/callback`;
      const safeBase = safeAppRedirect(rawRedirect);
      const expiresIn = expirySeconds(config.ACCESS_TOKEN_EXPIRY);
      const fragment = sessionFragment({
        accessToken,
        refreshToken,
        expiresIn,
        expiresAt: Math.floor(Date.now() / 1000) + expiresIn,
        type: "oauth",
      });
      return reply.redirect(`${safeBase}#${fragment}`);
    })
  );
}
