/**
 * POST /auth/admin/refresh — Refresh token ile yeni access token üret.
 *
 * Refresh token Redis'te geçerliyse yeni access token döner.
 * Redis yoksa 503 döner.
 *
 * Rate limit: IP başına 30 req/dk.
 */

import type { FastifyInstance } from "fastify";
import { JwtService } from "../../services/jwtService.js";
import { config } from "../../config/env.js";

export async function adminRefreshRoute(server: FastifyInstance) {
  const jwtService = new JwtService(config.JWT_SECRET);

  server.post(
    "/admin/refresh",
    {
      config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
      schema: {
        description: "Exchange a refresh token for a new access token.",
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
              accessToken: { type: "string" },
              expiresIn: { type: "string" },
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

      const session = await server.sessionService.get(refreshToken);
      if (!session) {
        return reply.status(401).send({ error: "Invalid or expired refresh token" });
      }

      const accessToken = await jwtService.signAdminToken(
        config.ACCESS_TOKEN_EXPIRY,
        session.email
      );

      return reply.send({
        accessToken,
        expiresIn: config.ACCESS_TOKEN_EXPIRY,
      });
    }
  );
}