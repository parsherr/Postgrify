/**
 * POST /:database/auth/signup — C-10 GoTrue-compatible session shape.
 *
 * email_verify_required=false → 200 + access/refresh tokens (auto session).
 * email_verify_required=true  → 200 + empty tokens, same shape.
 * Request: full_name / metadata / data (Supabase SDK `data` object).
 *
 * Rate limit: 5 req/dk (spam kaydı önle).
 */

import type { FastifyInstance } from "fastify";
import { asyncHandler } from "../../../utils/asyncHandler.js";
import { hashPassword } from "../../../services/passwordService.js";
import { JwtService } from "../../../services/jwtService.js";
import { ensureAuthSchema, insertAuditLog, getAuthSetting } from "./provision.js";
import { sendEmail, buildVerifyEmail } from "../../../services/emailService.js";
import { config } from "../../../config/env.js";
import {
  buildSessionResponse,
  parseDurationMs,
  type SessionResponse,
} from "./sessionResponse.js";
import crypto from "node:crypto";
import { validatePassword, parsePolicyFromSettings } from "../../../utils/passwordPolicy.js";

/**
 * Verification token'ı SHA-256 ile hash'ler — DB'de ham token saklanmaz.
 * Email bağlantısında plain token gönderilir; DB'de yalnızca hash tutulur.
 */
function hashVerificationToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function hashRefreshToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

type SignupBody = {
  email: string;
  password: string;
  full_name?: string;
  metadata?: Record<string, unknown>;
  data?: Record<string, unknown>;
};

function resolveSignupProfile(body: SignupBody): {
  fullName: string | null;
  extraMetadata: Record<string, unknown>;
} {
  const data = body.data && typeof body.data === "object" ? body.data : {};
  const metadata =
    body.metadata && typeof body.metadata === "object" ? body.metadata : {};
  const fullName =
    body.full_name ??
    (typeof data.full_name === "string" ? data.full_name : null) ??
    (typeof metadata.full_name === "string" ? metadata.full_name : null);

  const { full_name: _dFn, ...dataRest } = data;
  const { full_name: _mFn, ...metaRest } = metadata;
  return {
    fullName,
    extraMetadata: { ...metaRest, ...dataRest },
  };
}

export async function authSignupRoute(server: FastifyInstance) {
  const jwtService = new JwtService(() => config.JWT_SECRET);

  server.post(
    "/:database/auth/signup",
    {
      config: { rateLimit: { max: 5, timeWindow: "1 minute" } },
      schema: {
        description:
          "Register a new user (GoTrue-compatible session, C-10). Sends verification email if SMTP configured.",
        tags: ["db-auth"],
        security: [],
        body: {
          type: "object",
          required: ["email", "password"],
          properties: {
            email: { type: "string", format: "email" },
            password: { type: "string", minLength: 8 },
            full_name: { type: "string" },
            metadata: { type: "object", additionalProperties: true },
            data: { type: "object", additionalProperties: true },
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
              refresh_token: { type: "string" },
              user: {
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
              },
              email_verify_sent: { type: "boolean" },
              message: { type: "string" },
            },
          },
        },
      },
    },
    asyncHandler(async (req, reply) => {
      const { database } = req.params as { database: string };
      const body = req.body as SignupBody;
      const { email, password } = body;
      const { fullName, extraMetadata } = resolveSignupProfile(body);

      const sql = server.poolManager.getPool(database);
      await ensureAuthSchema(sql);

      const signupEnabled = await getAuthSetting(sql, "email_signup_enabled", "true");
      if (signupEnabled.toLowerCase() !== "true") {
        return reply.status(403).send({
          error: "Sign-up disabled",
          message: "New user registrations are currently disabled for this database.",
        });
      }

      const policySettings: Record<string, string> = {
        min_password_length: await getAuthSetting(sql, "min_password_length", "8"),
        password_require_uppercase: await getAuthSetting(
          sql,
          "password_require_uppercase",
          "false"
        ),
        password_require_number: await getAuthSetting(
          sql,
          "password_require_number",
          "false"
        ),
        password_require_special: await getAuthSetting(
          sql,
          "password_require_special",
          "false"
        ),
      };
      const policyCheck = validatePassword(password, parsePolicyFromSettings(policySettings));
      if (!policyCheck.valid) {
        return reply.status(400).send({ error: policyCheck.message });
      }

      const [existing] = await sql`
        SELECT id FROM _postgrify_auth.users WHERE email = ${email.toLowerCase()}
      `;
      if (existing) {
        await hashPassword(password);
        return reply.status(409).send({ error: "Email already registered" });
      }

      const passwordHash = await hashPassword(password);
      const isVerifyRequired =
        (await getAuthSetting(sql, "email_verify_required", "false")) === "true";

      const rawDefaultRole = await getAuthSetting(sql, "default_user_role", "viewer");
      const VALID_ROLES = ["viewer", "editor", "admin"] as const;
      const defaultUserRole: (typeof VALID_ROLES)[number] = (
        VALID_ROLES as readonly string[]
      ).includes(rawDefaultRole)
        ? (rawDefaultRole as (typeof VALID_ROLES)[number])
        : "viewer";

      const verificationToken = crypto.randomBytes(32).toString("hex");
      const verificationTokenHash = hashVerificationToken(verificationToken);
      const verificationExp = new Date(Date.now() + 24 * 60 * 60 * 1000);

      const [user] = await sql`
        INSERT INTO _postgrify_auth.users
          (email, password_hash, full_name, email_verified, provider, role)
        VALUES
          (${email.toLowerCase()}, ${passwordHash}, ${fullName}, false, 'email', ${defaultUserRole})
        RETURNING id, email, email_verified, role, created_at, metadata, provider, full_name, is_active
      `;

      const baseMetadata =
        Object.keys(extraMetadata).length > 0 ? { ...extraMetadata } : {};
      if (fullName && baseMetadata.full_name === undefined) {
        baseMetadata.full_name = fullName;
      }
      const metadataWithToken = {
        ...baseMetadata,
        verification_token: verificationTokenHash,
        verification_exp: verificationExp.toISOString(),
      };
      await sql`
        UPDATE _postgrify_auth.users
        SET metadata = ${JSON.stringify(metadataWithToken)}::jsonb
        WHERE id = ${user.id}
      `;

      await insertAuditLog(sql, "signup", user.id as string, {
        ip: req.ip,
        userAgent: req.headers["user-agent"],
      });

      let emailSent = false;
      try {
        await sendEmail(
          buildVerifyEmail({
            appUrl: config.APP_URL,
            database,
            token: verificationToken,
            email: user.email as string,
          })
        );
        emailSent = true;
      } catch (err) {
        server.log.warn({ err }, "Failed to send verification email");
      }

      const userRow = {
        id: user.id as string,
        email: user.email as string,
        role: user.role as string,
        is_active: (user.is_active as boolean) !== false,
        email_verified: user.email_verified as boolean,
        created_at: user.created_at as string | Date | null,
        metadata: baseMetadata,
        provider: (user.provider as string) ?? "email",
        full_name: (user.full_name as string | null) ?? fullName,
        avatar_url: null as string | null,
      };

      let session: SessionResponse;
      if (isVerifyRequired) {
        const expiresIn = Math.floor(parseDurationMs(config.ACCESS_TOKEN_EXPIRY) / 1000);
        session = {
          access_token: "",
          token_type: "bearer",
          expires_in: expiresIn,
          expires_at: Math.floor(Date.now() / 1000) + expiresIn,
          refresh_token: "",
          user: buildSessionResponse({
            accessToken: "",
            refreshToken: "",
            user: userRow,
          }).user,
        };
      } else {
        const accessToken = await jwtService.signDbUserToken(
          database,
          user.id as string,
          user.email as string,
          user.role as string,
          config.ACCESS_TOKEN_EXPIRY
        );
        const refreshToken = crypto.randomBytes(48).toString("hex");
        const refreshTokenHash = hashRefreshToken(refreshToken);
        const expiresAt = new Date(Date.now() + parseDurationMs(config.REFRESH_TOKEN_EXPIRY));
        await sql`
          INSERT INTO _postgrify_auth.sessions (user_id, refresh_token, expires_at, ip, user_agent)
          VALUES (${user.id}, ${refreshTokenHash}, ${expiresAt.toISOString()}, ${req.ip}, ${req.headers["user-agent"] ?? null})
        `;
        session = buildSessionResponse({
          accessToken,
          refreshToken,
          user: userRow,
        });
      }

      return reply.status(200).send({
        ...session,
        email_verify_sent: emailSent,
        message: isVerifyRequired
          ? "Account created. Please verify your email before signing in."
          : "Account created.",
      });
    })
  );
}
