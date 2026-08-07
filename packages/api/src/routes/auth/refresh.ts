/**
 * POST /auth/admin/refresh — Refresh token ile yeni access + refresh token çifti üret.
 *
 * Token rotation: eski refresh token revoke edilir, yeni çift döner.
 * Redis yoksa 503 döner.
 *
 * Rate limit: IP başına 30 req/dk.
 */

import type { FastifyInstance } from "fastify";
import { config } from "../../config/env.js";

export async function adminRefreshRoute(server: FastifyInstance) {
  server.post(
    "/admin/refresh",
    {
      config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
      schema: {
        description: "Exchange a refresh token for a new access + refresh token pair (rotation).",
        tags: ["auth"],
        security: [],
        body: {
          type: "object",
          required: ["refreshToken"],
          properties: {
            refreshToken: { type: "string" },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              accessToken:  { type: "string" },
              refreshToken: { type: "string" },
              expiresIn:    { type: "string" },
            },
          },
        },
      },
    },
    async (req, reply) => {
      const { refreshToken } = req.body as { refreshToken: string };

      if (!server.sessionService.isAvailable) {
        return reply.status(503).send({
          error: "Refresh token store unavailable",
          message: "REDIS_URL is not configured",
        });
      }

      // Önce geçerliliğini kontrol et
      const session = await server.sessionService.get(refreshToken);
      if (!session) {
        return reply.status(401).send({ error: "Invalid or expired refresh token" });
      }

      // Token rotation: eski sil, yeni üret
      const newRefreshToken = await server.sessionService.rotate(refreshToken, session.email);
      if (!newRefreshToken) {
        return reply.status(503).send({
          error: "Session rotation failed",
          message: "Could not rotate refresh token",
        });
      }

      const accessToken = await server.jwtService.signAdminToken(
        config.ACCESS_TOKEN_EXPIRY,
        session.email
      );

      return reply.send({
        accessToken,
        refreshToken: newRefreshToken,
        expiresIn: config.ACCESS_TOKEN_EXPIRY,
      });
    }
  );
}