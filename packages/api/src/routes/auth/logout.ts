/**
 * POST /auth/admin/logout — Admin oturumunu sonlandır.
 *
 * Hem Redis'teki refresh token'ı revoke eder
 * hem de access token JTI'sini kara listeye ekler.
 * Bu sayede access token süresi dolmadan da geçersiz kılınmış olur.
 */

import type { FastifyInstance } from "fastify";
import { jtiBlacklist } from "../../services/jwtService.js";
import { config } from "../../config/env.js";
import { JwtService } from "../../services/jwtService.js";

/** "15m", "1h", "7d" → saniye cinsinden. */
function expiryToSeconds(expiry: string): number {
  const match = expiry.match(/^(\d+)([smhd])$/);
  if (!match) return 3600;
  const value = parseInt(match[1], 10);
  const unit = match[2];
  const multipliers: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
  return value * (multipliers[unit] ?? 3600);
}

export async function adminLogoutRoute(server: FastifyInstance) {
  const jwtService = new JwtService(() => config.JWT_SECRET);

  server.post(
    "/admin/logout",
    {
      schema: {
        description: "Logout: revoke refresh token + blacklist current access token JTI.",
        tags: ["auth"],
        security: [{ bearerAuth: [] }],
        body: {
          type: "object",
          properties: {
            refreshToken: { type: "string" },
          },
        },
      },
    },
    async (req, reply) => {
      // Access token JTI'sini kara listeye ekle
      const authHeader = req.headers.authorization;
      if (authHeader?.startsWith("Bearer ")) {
        const token = authHeader.slice(7);
        const payload = await jwtService.verifyAdminOrDb(token);
        if (payload?.jti) {
          // Token'ın kalan TTL'ini hesapla
          const exp = (payload as { exp?: number }).exp;
          const ttl = exp ? Math.max(0, exp - Math.floor(Date.now() / 1000)) : expiryToSeconds(config.ACCESS_TOKEN_EXPIRY);
          await jtiBlacklist.add(payload.jti as string, ttl);
        }
      }

      // Refresh token revoke et (varsa)
      const { refreshToken } = (req.body ?? {}) as { refreshToken?: string };
      if (refreshToken && server.sessionService.isAvailable) {
        await server.sessionService.revoke(refreshToken);
      }

      return reply.status(204).send();
    }
  );
}