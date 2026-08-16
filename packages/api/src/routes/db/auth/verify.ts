/**
 * GET /:database/auth/verify — C-11 email verification.
 *
 * Query: token (required), type=signup|invite (default signup),
 *        redirect_to (optional → 302 + fragment; else JSON session).
 */

import type { FastifyInstance } from "fastify";
import { asyncHandler } from "../../../utils/asyncHandler.js";
import { ensureAuthSchema, insertAuditLog } from "./provision.js";
import { JwtService } from "../../../services/jwtService.js";
import { config } from "../../../config/env.js";
import {
  buildSessionResponse,
  parseDurationMs,
} from "./sessionResponse.js";
import { safeAppRedirect, sessionFragment } from "./redirectSafe.js";
import crypto from "node:crypto";

function hashVerificationToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

const VERIFY_TYPES = new Set(["signup", "invite", "email"]);

export async function authVerifyRoute(server: FastifyInstance) {
  const jwtService = new JwtService(() => config.JWT_SECRET);

  server.get(
    "/:database/auth/verify",
    {
      schema: {
        description:
          "Verify email via token (C-11). JSON session or redirect_to fragment.",
        tags: ["db-auth"],
        security: [],
        querystring: {
          type: "object",
          required: ["token"],
          properties: {
            token: { type: "string" },
            type: {
              type: "string",
              enum: ["signup", "invite", "email", "magiclink", "recovery"],
              default: "signup",
            },
            redirect_to: { type: "string" },
          },
        },
      },
    },
    asyncHandler(async (req, reply) => {
      const { database } = req.params as { database: string };
      const {
        token,
        type = "signup",
        redirect_to: redirectTo,
      } = req.query as {
        token: string;
        type?: string;
        redirect_to?: string;
      };

      if (type === "magiclink") {
        return reply.status(400).send({
          error: "Use GET /auth/magic-link/verify for magiclink tokens",
        });
      }
      if (type === "recovery") {
        return reply.status(400).send({
          error: "Use POST /auth/password/reset for recovery tokens",
        });
      }
      if (!VERIFY_TYPES.has(type)) {
        return reply.status(400).send({ error: `Unsupported verify type: ${type}` });
      }

      const sql = server.poolManager.getPool(database);
      await ensureAuthSchema(sql);

      const tokenHash = hashVerificationToken(token);

      const [user] = await sql`
        SELECT id, email, role, is_active, created_at, metadata, provider, full_name, avatar_url,
               metadata->>'verification_exp' AS verification_exp
        FROM _postgrify_auth.users
        WHERE metadata->>'verification_token' = ${tokenHash}
          AND email_verified = false
      `;

      if (!user) {
        return reply.status(400).send({ error: "Invalid or already used verification token" });
      }

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

      await insertAuditLog(sql, "email_verified", user.id as string, {
        ip: req.ip,
        userAgent: req.headers["user-agent"],
      });

      const meta =
        user.metadata && typeof user.metadata === "object"
          ? { ...(user.metadata as Record<string, unknown>) }
          : {};
      delete meta.verification_token;
      delete meta.verification_exp;

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
          type,
        });
        return reply.redirect(`${base}#${fragment}`);
      }

      return reply.send(session);
    })
  );
}
