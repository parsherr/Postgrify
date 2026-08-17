/**
 * DB Auth Token routes — email+password login, JWT generation and logout.
 *
 *   POST /:database/auth/login   — C-07 GoTrue snake_case session
 *   POST /:database/auth/logout  — revoke refresh token
 *   POST /:database/auth/refresh — obtain new access token (C-08 snake_case next step)
 *
 * These endpoints do not require the authenticate preHandler — they are public.
 * Rate limit: 10 req/min (brute-force protection).
 */

import type { FastifyInstance } from "fastify";
import { asyncHandler } from "../../../utils/asyncHandler.js";
import { verifyPassword } from "../../../services/passwordService.js";
import { JwtService } from "../../../services/jwtService.js";
import { config } from "../../../config/env.js";
import { ensureAuthSchema, insertAuditLog, getAuthSetting } from "./provision.js";
import { buildSessionResponse, parseDurationMs, pickRefreshToken } from "./sessionResponse.js";
import crypto from "node:crypto";

/**
 * Hashes a refresh token with SHA-256.
 *
 * Storing a plain-text refresh token in the DB would expose all active sessions
 * in the event of a DB dump or admin API leak.
 * By storing only the hash we reduce this risk to zero: the raw token cannot be
 * derived from the hash.
 *
 * Flow:
 *   login/refresh → generate randomBytes(48) token → write hash to DB → send raw token to client
 *   refresh/logout → hash the incoming raw token → look up by hash in the DB
 */
function hashRefreshToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

const RATE_LIMIT = { max: 10, timeWindow: "1 minute" } as const;

const sessionUserSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    aud: { type: "string" },
    role: { type: "string" },
    email: { type: "string" },
    email_confirmed_at: { type: ["string", "null"] },
    created_at: { type: "string" },
    updated_at: { type: "string" },
    app_metadata: { type: "object", additionalProperties: true },
    user_metadata: { type: "object", additionalProperties: true },
  },
} as const;

export async function authTokensRoute(server: FastifyInstance) {
  const jwtService = new JwtService(() => config.JWT_SECRET);

  // ── POST /:database/auth/login ────────────────────────────────────────────
  server.post(
    "/:database/auth/login",
    {
      config: { rateLimit: RATE_LIMIT },
      schema: {
        description:
          "Login with email + password (GoTrue-compatible snake_case session, C-07)",
        tags: ["db-auth"],
        security: [],
        body: {
          type: "object",
          required: ["email", "password"],
          properties: {
            email: { type: "string", format: "email" },
            password: { type: "string", minLength: 1 },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              access_token: { type: "string" },
              token_type: { type: "string" },
              expires_in: { type: "integer" },
              expires_at: { type: "integer" },
              refresh_token: { type: ["string", "null"] },
              user: sessionUserSchema,
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

      // Find the user (hash + lockout + GoTrue user fields)
      const [user] = await sql`
        SELECT id, email, password_hash, role, is_active,
               email_verified, failed_attempts, locked_until,
               created_at, metadata, provider, full_name, avatar_url
        FROM _postgrify_auth.users
        WHERE email = ${email.toLowerCase()}
      `;

      if (!user) {
        // Timing-safe: simulate hash-verify cost even when the user does not exist
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

      // Account lockout check — too many failed attempts
      if (user.locked_until && new Date(user.locked_until as string) > new Date()) {
        await insertAuditLog(sql, "login_failed", user.id as string, {
          ip: req.ip,
          userAgent: req.headers["user-agent"],
          metadata: { reason: "account_locked", locked_until: user.locked_until },
        });
        return reply.status(429).send({
          error: "Account temporarily locked due to too many failed login attempts",
          lockedUntil: user.locked_until,
        });
      }
    // Handle DB user token separately
      // email_verify_required check — getAuthSetting returns a normalized lowercase value
      const verifyRequired = await getAuthSetting(sql, "email_verify_required", "false");
      if (verifyRequired === "true" && !user.email_verified) {
        return reply.status(403).send({
          error: "Email not verified",
          message: "Please verify your email address before signing in.",
        });
      }

      const valid = await verifyPassword(user.password_hash as string, password);
      if (!valid) {
        // Increment failed attempt count; lock the account if the policy threshold is exceeded
        const maxAttempts = parseInt(
          await getAuthSetting(sql, "account_lockout_attempts", "5"),
          10
        );
        const lockMinutes = parseInt(
          await getAuthSetting(sql, "account_lockout_minutes", "15"),
          10
        );
        const newAttempts = ((user.failed_attempts as number) ?? 0) + 1;
        const shouldLock = newAttempts >= maxAttempts;
        const lockedUntil = shouldLock
          ? new Date(Date.now() + lockMinutes * 60_000).toISOString()
          : null;

        await sql`
          UPDATE _postgrify_auth.users
          SET failed_attempts = ${newAttempts},
              locked_until    = ${lockedUntil}
          WHERE id = ${user.id}
        `;

        await insertAuditLog(sql, "login_failed", user.id as string, {
          ip: req.ip,
          userAgent: req.headers["user-agent"],
          metadata: { reason: "wrong_password", attempt: newAttempts, locked: shouldLock },
        });
        return reply.status(401).send({ error: "Invalid credentials" });
      }

      // Successful login — reset failed_attempts and locked_until + update last_login
      await sql`
        UPDATE _postgrify_auth.users
        SET last_login      = now(),
            failed_attempts = 0,
            locked_until    = NULL
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

      // Refresh token — store the hash in the DB, send the raw token to the client.
      const refreshToken = crypto.randomBytes(48).toString("hex");
      const refreshTokenHash = hashRefreshToken(refreshToken);
      const expiresAt = new Date(Date.now() + parseDurationMs(config.REFRESH_TOKEN_EXPIRY));

      await sql`
        INSERT INTO _postgrify_auth.sessions (user_id, refresh_token, expires_at, ip, user_agent)
        VALUES (${user.id}, ${refreshTokenHash}, ${expiresAt.toISOString()}, ${req.ip}, ${req.headers["user-agent"] ?? null})
      `;

      return reply.send(
        buildSessionResponse({
          accessToken,
          refreshToken,
          user: {
            id: user.id as string,
            email: user.email as string,
            role: user.role as string,
            is_active: user.is_active as boolean,
            email_verified: user.email_verified as boolean,
            created_at: user.created_at as string | Date | null,
            metadata: user.metadata as Record<string, unknown> | null,
            provider: user.provider as string | null,
            full_name: user.full_name as string | null,
            avatar_url: user.avatar_url as string | null,
          },
        })
      );
    })
  );

  // ── POST /:database/auth/refresh (C-08) ───────────────────────────────────
  server.post(
    "/:database/auth/refresh",
    {
      config: { rateLimit: RATE_LIMIT },
      schema: {
        description:
          "Exchange refresh token for GoTrue-compatible session (snake_case, C-08)",
        tags: ["db-auth"],
        security: [],
        body: {
          type: "object",
          properties: {
            refresh_token: { type: "string" },
            refreshToken: { type: "string" },
          },
          anyOf: [{ required: ["refresh_token"] }, { required: ["refreshToken"] }],
        },
        response: {
          200: {
            type: "object",
            properties: {
              access_token: { type: "string" },
              token_type: { type: "string" },
              expires_in: { type: "integer" },
              expires_at: { type: "integer" },
              refresh_token: { type: ["string", "null"] },
              user: sessionUserSchema,
            },
          },
        },
      },
    },
    asyncHandler(async (req, reply) => {
      const { database } = req.params as { database: string };
      const refreshToken = pickRefreshToken(req.body as Record<string, unknown>);
      if (!refreshToken) {
        return reply.status(400).send({ error: "refresh_token is required" });
      }

      const sql = server.poolManager.getPool(database);
      await ensureAuthSchema(sql);

      const incomingHash = hashRefreshToken(refreshToken);

      let session = (
        await sql`
        SELECT s.id, s.user_id, s.expires_at, s.revoked, s.revoked_at,
               u.email, u.role, u.is_active, u.email_verified,
               u.created_at, u.metadata, u.provider, u.full_name, u.avatar_url
        FROM _postgrify_auth.sessions s
        JOIN _postgrify_auth.users u ON u.id = s.user_id
        WHERE s.refresh_token = ${incomingHash}
          AND s.revoked = false
          AND s.expires_at > now()
      `
      )[0] as Record<string, unknown> | undefined;

      if (!session) {
        const revoked = (
          await sql`
          SELECT s.id, s.user_id, s.revoked_at, s.expires_at,
                 u.email, u.role, u.is_active, u.email_verified,
                 u.created_at, u.metadata, u.provider, u.full_name, u.avatar_url
          FROM _postgrify_auth.sessions s
          JOIN _postgrify_auth.users u ON u.id = s.user_id
          WHERE s.refresh_token = ${incomingHash}
            AND s.revoked = true
        `
        )[0] as Record<string, unknown> | undefined;

        if (!revoked) {
          return reply.status(401).send({ error: "Invalid or expired refresh token" });
        }

        // An expired-then-revoked token must never re-enter the rotation chain,
        // even within the grace window — expiry is absolute.
        const originalExpiresAt = revoked.expires_at
          ? new Date(revoked.expires_at as string).getTime()
          : 0;
        if (originalExpiresAt > 0 && Date.now() > originalExpiresAt) {
          return reply.status(401).send({ error: "Invalid or expired refresh token" });
        }

        const reuseMs = config.REFRESH_TOKEN_REUSE_INTERVAL_SECONDS * 1000;
        const revokedAtMs = revoked.revoked_at
          ? new Date(revoked.revoked_at as string).getTime()
          : 0;
        const withinGrace =
          reuseMs > 0 && revokedAtMs > 0 && Date.now() - revokedAtMs <= reuseMs;

        if (!withinGrace) {
          // Reuse outside grace → revoke entire user session family (attack signal)
          await sql`
            UPDATE _postgrify_auth.sessions
            SET revoked = true, revoked_at = COALESCE(revoked_at, now())
            WHERE user_id = ${revoked.user_id as string} AND revoked = false
          `;
          await insertAuditLog(sql, "refresh_token_reuse", revoked.user_id as string, {
            ip: req.ip,
            userAgent: req.headers["user-agent"],
            metadata: { reason: "reuse_outside_grace" },
          });
          return reply.status(401).send({ error: "Invalid or expired refresh token" });
        }

        // Grace: allow another rotation without family revoke (ADR-012)
        if (!revoked.is_active) {
          return reply.status(403).send({ error: "Account is disabled" });
        }
        session = revoked;
      }

      if (!session.is_active) {
        return reply.status(403).send({ error: "Account is disabled" });
      }

      const sessionId = session.id as string;
      const sessionUserId = session.user_id as string;

      // Revoke the old token (token rotation) — only if the row is still active
      await sql`
        UPDATE _postgrify_auth.sessions
        SET revoked = true, revoked_at = now()
        WHERE id = ${sessionId} AND revoked = false
      `;

      const newRefreshToken = crypto.randomBytes(48).toString("hex");
      const newRefreshTokenHash = hashRefreshToken(newRefreshToken);
      const expiresAt = new Date(Date.now() + parseDurationMs(config.REFRESH_TOKEN_EXPIRY));

      await sql`
        INSERT INTO _postgrify_auth.sessions (user_id, refresh_token, expires_at, ip, user_agent)
        VALUES (${sessionUserId}, ${newRefreshTokenHash}, ${expiresAt.toISOString()}, ${req.ip}, ${req.headers["user-agent"] ?? null})
      `;

      const accessToken = await jwtService.signDbUserToken(
        database,
        sessionUserId,
        session.email as string,
        session.role as string,
        config.ACCESS_TOKEN_EXPIRY
      );

      return reply.send(
        buildSessionResponse({
          accessToken,
          refreshToken: newRefreshToken,
          user: {
            id: sessionUserId,
            email: session.email as string,
            role: session.role as string,
            is_active: session.is_active as boolean,
            email_verified: session.email_verified as boolean,
            created_at: session.created_at as string | Date | null,
            metadata: session.metadata as Record<string, unknown> | null,
            provider: session.provider as string | null,
            full_name: session.full_name as string | null,
            avatar_url: session.avatar_url as string | null,
          },
        })
      );
    })
  );

  // ── POST /:database/auth/logout (C-09) ────────────────────────────────────
  server.post(
    "/:database/auth/logout",
    {
      schema: {
        description:
          "Logout — revoke session(s). Prefer Authorization Bearer; body refresh_token still accepted (C-09)",
        tags: ["db-auth"],
        security: [],
        querystring: {
          type: "object",
          properties: {
            scope: {
              type: "string",
              enum: ["global", "local", "others"],
              default: "local",
            },
          },
        },
        body: {
          type: "object",
          properties: {
            refresh_token: { type: "string" },
            refreshToken: { type: "string" },
          },
        },
      },
    },
    asyncHandler(async (req, reply) => {
      const { database } = req.params as { database: string };
      const { scope = "local" } = req.query as {
        scope?: "global" | "local" | "others";
      };
      const refreshToken = pickRefreshToken(
        (req.body as Record<string, unknown> | null) ?? {}
      );

      const sql = server.poolManager.getPool(database);
      await ensureAuthSchema(sql);

      let userId: string | null = null;
      const authHeader = req.headers.authorization;
      if (authHeader?.startsWith("Bearer ")) {
        const payload = await jwtService.verifyDbUser(authHeader.slice(7));
        if (payload?.sub) userId = payload.sub;
      }

      let refreshHash: string | null = null;
      if (refreshToken) {
        refreshHash = hashRefreshToken(refreshToken);
        const [session] = await sql`
          SELECT user_id FROM _postgrify_auth.sessions
          WHERE refresh_token = ${refreshHash}
        `;
        if (session?.user_id) {
          if (userId && userId !== session.user_id) {
            return reply.status(403).send({ error: "Token does not belong to this user" });
          }
          userId = session.user_id as string;
        }
      }

      if (scope === "global") {
        if (!userId) {
          return reply.status(401).send({
            error: "Authorization Bearer or refresh_token required for scope=global",
          });
        }
        await sql`
          UPDATE _postgrify_auth.sessions
          SET revoked = true, revoked_at = COALESCE(revoked_at, now())
          WHERE user_id = ${userId} AND revoked = false
        `;
        await insertAuditLog(sql, "logout", userId, {
          ip: req.ip,
          userAgent: req.headers["user-agent"] as string | undefined,
          metadata: { scope: "global" },
        });
        return reply.status(204).send();
      }

      if (scope === "others") {
        if (!userId || !refreshHash) {
          return reply.status(400).send({
            error: "scope=others requires Authorization Bearer and refresh_token (session to keep)",
          });
        }
        await sql`
          UPDATE _postgrify_auth.sessions
          SET revoked = true, revoked_at = COALESCE(revoked_at, now())
          WHERE user_id = ${userId}
            AND revoked = false
            AND refresh_token <> ${refreshHash}
        `;
        await insertAuditLog(sql, "logout", userId, {
          ip: req.ip,
          userAgent: req.headers["user-agent"] as string | undefined,
          metadata: { scope: "others" },
        });
        return reply.status(204).send();
      }

      // local (default) — revoke one refresh token
      if (!refreshHash) {
        return reply.status(400).send({
          error: "refresh_token required for scope=local (or use scope=global with Bearer)",
        });
      }

      await sql`
        UPDATE _postgrify_auth.sessions
        SET revoked = true, revoked_at = COALESCE(revoked_at, now())
        WHERE refresh_token = ${refreshHash}
      `;
      if (userId) {
        await insertAuditLog(sql, "logout", userId, {
          ip: req.ip,
          userAgent: req.headers["user-agent"] as string | undefined,
          metadata: { scope: "local" },
        });
      }

      return reply.status(204).send();
    })
  );
}
