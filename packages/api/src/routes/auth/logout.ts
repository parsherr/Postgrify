/**
 * POST /auth/admin/logout — Terminate an admin session.
 *
 * Revokes the refresh token in Redis and blacklists the
 * current access token JTI, invalidating it before it expires.
 */

import type { FastifyInstance } from "fastify";
import { jtiBlacklist } from "../../services/jwtService.js";
import { config } from "../../config/env.js";
import { JwtService } from "../../services/jwtService.js";

/** "15m", "1h", "7d" → value in seconds. */
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
      // Blacklist the access token JTI
      const authHeader = req.headers.authorization;
      if (authHeader?.startsWith("Bearer ")) {
        const token = authHeader.slice(7);
        const payload = await jwtService.verifyAdminOrDb(token);
        if (payload?.jti) {
          // Calculate the token's remaining TTL
          const exp = (payload as { exp?: number }).exp;
          const ttl = exp ? Math.max(0, exp - Math.floor(Date.now() / 1000)) : expiryToSeconds(config.ACCESS_TOKEN_EXPIRY);
          await jtiBlacklist.add(payload.jti as string, ttl);
        }
      }

      // Revoke the refresh token (if provided)
      const { refreshToken } = (req.body ?? {}) as { refreshToken?: string };
      if (refreshToken && server.sessionService.isAvailable) {
        await server.sessionService.revoke(refreshToken);
      }

      return reply.status(204).send();
    }
  );
}