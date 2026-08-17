/**
 * OAuth flow:
 *
 *   GET /:database/auth/oauth/:provider           — redirect to provider
 *   GET /:database/auth/oauth/:provider/callback  — code exchange, create session
 *
 * The state parameter is used for CSRF protection (opaque token, bound to the session).
 * Provider config is read from the DB (_postgrify_auth.oauth_providers).
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
 * With Redis: states are stored in Redis with a TTL — persistent across restarts and multiple instances.
 * Without Redis: in-memory Map fallback — single instance, resets on restart.
 *
 * State value is stored as a JSON string: { database, provider, exp }
 */

const STATE_TTL_SECONDS = 10 * 60; // 10 minutes

interface OAuthState {
  database: string;
  provider: string;
  exp: number;
  /** C-14: same-origin post-login URL (validated) */
  redirectTo?: string;
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

// In-memory fallback (when Redis is unavailable)
const memStateStore = new Map<string, OAuthState>();

// In-memory TTL cleanup
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of memStateStore) {
    if (val.exp < now) memStateStore.delete(key);
  }
}, 5 * 60 * 1000);

export async function authOAuthRoute(server: FastifyInstance) {
  const jwtService = new JwtService(() => config.JWT_SECRET);

  // Redis client — for the state store (if available).
  // Falls back to memStateStore when Redis is unavailable.
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

  // ── GET /:database/auth/oauth/:provider (C-14 redirect_to + scopes) ─────
  server.get(
    "/:database/auth/oauth/:provider",
    {
      config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
      schema: {
        description:
          "Initiate OAuth flow (C-14). Optional redirect_to (same-origin) and scopes.",
        tags: ["db-auth"],
        security: [],
        params: {
          type: "object",
          properties: {
            database: { type: "string" },
            provider: { type: "string", enum: ["google", "github"] },
          },
        },
        querystring: {
          type: "object",
          properties: {
            redirect_to: { type: "string" },
            scopes: { type: "string", description: "Space-separated OAuth scopes" },
          },
        },
      },
    },
    asyncHandler(async (req, reply) => {
      const { database, provider } = req.params as { database: string; provider: string };
      const { redirect_to: redirectTo, scopes } = req.query as {
        redirect_to?: string;
        scopes?: string;
      };

      const sql = server.poolManager.getPool(database);
      await ensureAuthSchema(sql);

      const oauthEnabled = await getAuthSetting(sql, "oauth_enabled", "false");
      if (oauthEnabled !== "true") {
        return reply.status(403).send({
          error: "OAuth disabled",
          message: "OAuth sign-in is not enabled for this database.",
        });
      }

      const [providerRow] = await sql`
        SELECT client_id, client_secret, redirect_uri
        FROM _postgrify_auth.oauth_providers
        WHERE provider = ${provider} AND enabled = true
      `;

      if (!providerRow) {
        return reply.status(404).send({ error: `OAuth provider '${provider}' not configured` });
      }

      const state = crypto.randomBytes(16).toString("hex");
      await stateSet(redisClient, memStateStore, state, {
        database,
        provider,
        exp: Date.now() + STATE_TTL_SECONDS * 1000,
        // Always run through same-origin guard (evil → APP_URL/auth/callback)
        redirectTo: redirectTo ? safeAppRedirect(redirectTo) : undefined,
      });

      const url = getAuthUrl(
        provider,
        {
          clientId: providerRow.client_id as string,
          clientSecret: providerRow.client_secret as string,
          redirectUri: providerRow.redirect_uri as string,
        },
        state,
        scopes
      );

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

    // CSRF protection: validate state
      const stateData = await stateGet(redisClient, memStateStore, state);
      if (!stateData || stateData.database !== database || stateData.provider !== provider) {
        return reply.status(400).send({ error: "Invalid or expired OAuth state" });
      }
      await stateDel(redisClient, memStateStore, state);
      const pendingRedirect = stateData.redirectTo;

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

    // Find or create user
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
        // Update the existing user's OAuth information
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

    // Create session and return token
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

      // C-14: prefer redirect_to from initiate state; else signup_redirect_url setting
      let rawRedirect = pendingRedirect;
      if (!rawRedirect) {
        const [redirectSetting] = await sql`
          SELECT value FROM _postgrify_auth.auth_settings
          WHERE key = 'signup_redirect_url'
        `;
        rawRedirect =
          (redirectSetting?.value as string) || `${config.APP_URL}/auth/callback`;
      }
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
