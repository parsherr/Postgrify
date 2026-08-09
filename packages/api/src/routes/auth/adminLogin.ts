/**
 * POST /auth/admin/login — Email + şifre ile admin girişi.
 *
 * Başarılıysa access token (JWT) + refresh token (opaque) döner.
 * Refresh token Redis'te saklanır; Redis yoksa sadece access token döner.
 *
 * Credentials okuma önceliği:
 *   1. process.env  — pool plugin onReady'de DB'den yüklendi veya setup'ta inject edildi
 *   2. config       — startup'ta .env'den yüklendi
 *   3. server.settings (DB) — hem 1 hem 2 boşsa son çare; bu yol pool plugin çalışmadan
 *      setup/status endpoint'ine çok hızlı istek geldiğinde devreye girebilir
 *
 * Rate limit: IP başına 10 req/dk (brute-force koruması).
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

      // Credentials okuma: process.env → config → DB
      // pool plugin onReady'de DB'den yüklenen değerler process.env'e yazılır.
      // setup.ts da doğrudan process.env'e inject eder.
      // config startup snapshot'ı; runtime değişiklikler için process.env güvenilir.
      let adminEmail = process.env.ADMIN_EMAIL ?? config.ADMIN_EMAIL ?? "";
      let adminHash = process.env.ADMIN_PASSWORD_HASH ?? config.ADMIN_PASSWORD_HASH ?? "";

      // Son çare: DB'den oku (onReady henüz çalışmadıysa veya race condition)
      if ((!adminEmail || !adminHash) && server.hasDecorator("settings")) {
        try {
          const creds = await server.settings.getAdminCredentials();
          if (creds) {
            adminEmail = creds.email;
            adminHash = creds.passwordHash;
            // Sonraki login'lerde DB'ye gitmemek için process.env'i güncelle
            process.env.ADMIN_EMAIL = adminEmail;
            process.env.ADMIN_PASSWORD_HASH = adminHash;
            (config as Record<string, unknown>).ADMIN_EMAIL = adminEmail;
            (config as Record<string, unknown>).ADMIN_PASSWORD_HASH = adminHash;
          }
        } catch {
          // DB hatası — boş credentials ile devam et, 503 döner
        }
      }

      if (!adminEmail || !adminHash) {
        return reply.status(503).send({
          error: "Admin credentials not configured",
          message: "Set ADMIN_EMAIL and ADMIN_PASSWORD_HASH environment variables",
        });
      }

      // Timing-safe kontrol: email eşleşip eşleşmediğinden bağımsız olarak
      // her zaman argon2id hash doğrulaması yapılır. Bu sayede response süresi
      // sabit kalır ve saldırgan timing farkından admin email'i keşfedemez.
      //
      // Neden önemli: email eşleşmezse verifyPassword atlanırsa (~0ms),
      // eşleşirse verifyPassword ~100-300ms sürer → timing saldırısı ile
      // admin email'i düzinelerce deneyle tespit edilebilir.
      const emailMatch = email.toLowerCase() === adminEmail.toLowerCase();
      const valid = await verifyPassword(adminHash, password);

      if (!emailMatch || !valid) {
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