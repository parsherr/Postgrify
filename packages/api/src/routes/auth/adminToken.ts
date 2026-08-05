/**
 * POST /auth/token/admin — Admin JWT üretir.
 * Body: { adminSecret, expiresIn? }
 *
 * Rate limit: IP başına 10 req/dk.
 */

import type { FastifyInstance } from "fastify";
import { JwtService } from "../../services/jwtService.js";
import { config } from "../../config/env.js";

export async function adminTokenRoute(server: FastifyInstance) {
  const jwtService = new JwtService(config.JWT_SECRET);

  server.post(
    "/token/admin",
    {
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
      schema: {
        description: "Issue an admin JWT with full access",
        tags: ["auth"],
        security: [],
        body: {
          type: "object",
          required: ["adminSecret"],
          properties: {
            adminSecret: { type: "string" },
            expiresIn: { type: "string", default: "24h" },
          },
        },
      },
    },
    async (req, reply) => {
      const { adminSecret, expiresIn } = req.body as {
        adminSecret: string;
        expiresIn?: string;
      };

      if (adminSecret !== config.ADMIN_SECRET) {
        return reply.status(401).send({ error: "Invalid admin secret" });
      }

      const token = await jwtService.signAdminToken(expiresIn ?? "24h");
      return reply.send({ token, role: "admin" });
    }
  );
}