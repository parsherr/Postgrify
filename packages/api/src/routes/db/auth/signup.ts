/**
 * POST /:database/auth/signup — Yeni kullanıcı kaydı.
 *
 * email_verify_required=true ise kullanıcı verify edilmeden giriş yapamaz.
 * SMTP yapılandırılmışsa verify emaili gönderilir; yoksa console'a loglanır.
 *
 * Rate limit: 5 req/dk (spam kaydı önle).
 */

import type { FastifyInstance } from "fastify";
import { asyncHandler } from "../../../utils/asyncHandler.js";
import { hashPassword } from "../../../services/passwordService.js";
import { ensureAuthSchema, insertAuditLog, getAuthSetting } from "./provision.js";
import { sendEmail, buildVerifyEmail } from "../../../services/emailService.js";
import { config } from "../../../config/env.js";
import crypto from "node:crypto";

export async function authSignupRoute(server: FastifyInstance) {
  server.post(
    "/:database/auth/signup",
    {
      config: { rateLimit: { max: 5, timeWindow: "1 minute" } },
      schema: {
        description: "Register a new user. Sends verification email if SMTP is configured.",
        tags: ["db-auth"],
        security: [],
        body: {
          type: "object",
          required: ["email", "password"],
          properties: {
            email:     { type: "string", format: "email" },
            password:  { type: "string", minLength: 8 },
            full_name: { type: "string" },
          },
        },
        response: {
          201: {
            type: "object",
            properties: {
              ok:                   { type: "boolean" },
              email_verify_sent:    { type: "boolean" },
              message:              { type: "string" },
              user: {
                type: "object",
                properties: {
                  id:             { type: "string" },
                  email:          { type: "string" },
                  email_verified: { type: "boolean" },
                  role:           { type: "string" },
                },
              },
            },
          },
        },
      },
    },
    asyncHandler(async (req, reply) => {
      const { database } = req.params as { database: string };
      const { email, password, full_name } = req.body as {
        email: string;
        password: string;
        full_name?: string;
      };

      const sql = server.poolManager.getPool(database);
      await ensureAuthSchema(sql);

      // Signup feature flag kontrolü
      const signupEnabled = await getAuthSetting(sql, "email_signup_enabled", "true");
      if (signupEnabled !== "true") {
        return reply.status(403).send({
          error: "Sign-up disabled",
          message: "New user registrations are currently disabled for this database.",
        });
      }

      // Email unique kontrolü
      const [existing] = await sql`
        SELECT id FROM _postgrify_auth.users WHERE email = ${email.toLowerCase()}
      `;
      if (existing) {
        // Timing-safe: her durumda aynı gecikme
        await hashPassword(password);
        return reply.status(409).send({ error: "Email already registered" });
      }

      const passwordHash = await hashPassword(password);
      const verifyRequired = await getAuthSetting(sql, "email_verify_required", "false");
      const verificationToken = crypto.randomBytes(32).toString("hex");
      const verificationExp = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 saat

      const [user] = await sql`
        INSERT INTO _postgrify_auth.users
          (email, password_hash, full_name, email_verified, provider)
        VALUES
          (${email.toLowerCase()}, ${passwordHash}, ${full_name ?? null}, false, 'email')
        RETURNING id, email, email_verified, role
      `;

      // Verify token'ı kaydet
      await sql`
        UPDATE _postgrify_auth.users
        SET
          metadata = jsonb_set(
            jsonb_set(metadata, '{verification_token}', ${JSON.stringify(verificationToken)}::jsonb),
            '{verification_exp}', ${JSON.stringify(verificationExp.toISOString())}::jsonb
          )
        WHERE id = ${user.id}
      `;

      // Audit log
      await insertAuditLog(sql, "signup", user.id as string, {
        ip: req.ip,
        userAgent: req.headers["user-agent"],
      });

      // Verify emaili gönder
      let emailSent = false;
      try {
        await sendEmail(buildVerifyEmail({
          appUrl: config.APP_URL,
          database,
          token: verificationToken,
          email: user.email as string,
        }));
        emailSent = true;
      } catch (err) {
        server.log.warn({ err }, "Failed to send verification email");
      }

      return reply.status(201).send({
        ok: true,
        email_verify_sent: emailSent,
        message: verifyRequired === "true"
          ? "Hesabınız oluşturuldu. Giriş yapmak için email adresinizi doğrulayın."
          : "Hesabınız oluşturuldu.",
        user: {
          id:             user.id,
          email:          user.email,
          email_verified: user.email_verified,
          role:           user.role,
        },
      });
    })
  );
}