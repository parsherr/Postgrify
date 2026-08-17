/**
 * POST /auth/admin/login — Admin login with email + password.
 *
 * On success returns an access token (JWT) + refresh token (opaque).
 * Refresh token is stored in Redis; if Redis is unavailable only the access token is returned.
 *
 * Credentials read priority:
 *   1. process.env  — loaded from DB by pool plugin onReady, or injected during setup
 *   2. config       — loaded from .env at startup
 *   3. server.settings (DB) — last resort when both 1 and 2 are empty; this path
 *      can activate when a request arrives before the pool plugin has finished running
 *
 * Rate limit: 10 req/min per IP (brute-force protection).
 */

import type { FastifyInstance } from "fastify";
import { JwtService } from "../../services/jwtService.js";
import { verifyPassword } from "../../services/passwordService.js";
import { config } from "../../config/env.js";

export async function adminLoginRoute(server: FastifyInstance) {
  const jwtService = new JwtService(() => config.JWT_SECRET);

  server.post(
    "/admin/login",
    {
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
      schema: {
        description: "Admin login with email + password. Returns access token and refresh token.",
        tags: ["auth"],
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
              accessToken: { type: "string" },
              refreshToken: { type: "string" },
              expiresIn: { type: "string" },
              email: { type: "string" },
            },
          },
        },
      },
    },
    async (req, reply) => {
      const { email, password } = req.body as { email: string; password: string };

      // Credentials read order: process.env → config → DB
      // Values loaded from DB by pool plugin onReady are written to process.env.
      // setup.ts also injects directly into process.env.
      // config is a startup snapshot; process.env is authoritative for runtime changes.
      let adminEmail = process.env.ADMIN_EMAIL ?? config.ADMIN_EMAIL ?? "";
      let adminHash = process.env.ADMIN_PASSWORD_HASH ?? config.ADMIN_PASSWORD_HASH ?? "";

      // Last resort: read from DB (onReady not yet run, or race condition)
      if ((!adminEmail || !adminHash) && server.hasDecorator("settings")) {
        try {
          const creds = await server.settings.getAdminCredentials();
          if (creds) {
            adminEmail = creds.email;
            adminHash = creds.passwordHash;
            // Update process.env so subsequent logins skip the DB round-trip
            process.env.ADMIN_EMAIL = adminEmail;
            process.env.ADMIN_PASSWORD_HASH = adminHash;
            (config as Record<string, unknown>).ADMIN_EMAIL = adminEmail;
            (config as Record<string, unknown>).ADMIN_PASSWORD_HASH = adminHash;
          }
        } catch {
          // DB error — continue with empty credentials, will return 503
        }
      }

      if (!adminEmail || !adminHash) {
        return reply.status(503).send({
          error: "Admin credentials not configured",
          message: "Set ADMIN_EMAIL and ADMIN_PASSWORD_HASH environment variables",
        });
      }

      // Timing-safe check: argon2id hash verification is always performed
      // regardless of whether the email matches. This keeps response time
      // constant so an attacker cannot discover the admin email via timing differences.
      //
      // Why this matters: if verifyPassword were skipped on email mismatch (~0ms)
      // but run on a match (~100-300ms), an attacker could identify the admin
      // email with a few dozen probes via a timing attack.
      const emailMatch = email.toLowerCase() === adminEmail.toLowerCase();
      const valid = await verifyPassword(adminHash, password);

      if (!emailMatch || !valid) {
        return reply.status(401).send({ error: "Invalid credentials" });
      }

      // Issue access token
      const accessToken = await jwtService.signAdminToken(
        config.ACCESS_TOKEN_EXPIRY,
        email
      );

      // Refresh token (if Redis is available)
      const refreshToken = await server.sessionService.create(email);

      return reply.send({
        accessToken,
        refreshToken: refreshToken ?? null,
        expiresIn: config.ACCESS_TOKEN_EXPIRY,
        email,
      });
    }
  );
}