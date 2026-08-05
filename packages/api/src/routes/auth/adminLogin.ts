/**
 * POST /auth/admin/login — Email + şifre ile admin girişi.
 *
 * Başarılıysa access token (JWT) + refresh token (opaque) döner.
 * Refresh token Redis'te saklanır; Redis yoksa sadece access token döner.
 *
 * Rate limit: IP başına 10 req/dk (brute-force koruması).
 */

import type { FastifyInstance } from "fastify";
import { JwtService } from "../../services/jwtService.js";
import { verifyPassword } from "../../services/passwordService.js";
import { config } from "../../config/env.js";

export async function adminLoginRoute(server: FastifyInstance) {
  const jwtService = new JwtService(config.JWT_SECRET);

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

      // Admin kimlik bilgileri yapılandırılmamış
      if (!config.ADMIN_EMAIL || !config.ADMIN_PASSWORD_HASH) {
        return reply.status(503).send({
          error: "Admin credentials not configured",
          message: "Set ADMIN_EMAIL and ADMIN_PASSWORD_HASH environment variables",
        });
      }

      // Email kontrolü — timing-safe olmayan basit eşleşme yeterli
      // (email zaten public bilgi; hash verify asıl timing-safe olan kısım)
      if (email.toLowerCase() !== config.ADMIN_EMAIL.toLowerCase()) {
        return reply.status(401).send({ error: "Invalid credentials" });
      }

      // Şifre doğrulama — argon2id timing-safe
      const valid = await verifyPassword(config.ADMIN_PASSWORD_HASH, password);
      if (!valid) {
        return reply.status(401).send({ error: "Invalid credentials" });
      }

      // Access token
      const accessToken = await jwtService.signAdminToken(
        config.ACCESS_TOKEN_EXPIRY,
        email
      );

      // Refresh token (Redis varsa)
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