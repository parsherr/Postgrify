/**
 * POST /auth/token/admin — Admin JWT üretir.
 * Body: { adminSecret, expiresIn? }
 *
 * Rate limit: IP başına 10 req/dk.
 */

import type { FastifyInstance } from "fastify";
import { timingSafeEqual } from "node:crypto";
import { JwtService } from "../../services/jwtService.js";
import { config } from "../../config/env.js";

// expiresIn string'ini saniyeye çevirir; sınırı aşarsa hata fırlatır.
function assertExpiresIn(value: string, maxHours: number): void {
  const match = value.match(/^(\d+)(s|m|h|d)$/);
  if (!match) throw new Error(`Invalid expiresIn format: '${value}'. Use e.g. '1h', '30m'.`);
  const [, num, unit] = match;
  const hours = { s: 1 / 3600, m: 1 / 60, h: 1, d: 24 }[unit as "s" | "m" | "h" | "d"]!;
  if (Number(num) * hours > maxHours) {
    throw new Error(`expiresIn '${value}' exceeds maximum allowed ${maxHours}h`);
  }
}

export async function adminTokenRoute(server: FastifyInstance) {
  const jwtService = new JwtService(() => config.JWT_SECRET);

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

      // Timing-safe karşılaştırma — brute-force zamanlamasını önler
      const provided = Buffer.from(adminSecret);
      const expected = Buffer.from(config.ADMIN_SECRET);
      const valid =
        provided.length === expected.length &&
        timingSafeEqual(provided, expected);

      if (!valid) {
        return reply.status(401).send({ error: "Invalid admin secret" });
      }

      // Admin token max 24 saat
      const expiry = expiresIn ?? "24h";
      try {
        assertExpiresIn(expiry, 24);
      } catch (err) {
        return reply.status(400).send({ error: (err as Error).message });
      }

      const token = await jwtService.signAdminToken(expiry);
      return reply.send({ token, role: "admin" });
    }
  );
}