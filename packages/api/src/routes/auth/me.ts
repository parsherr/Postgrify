/**
 * GET /auth/admin/me — Geçerli admin kullanıcı bilgilerini döner.
 *
 * Token payload'ından email, role, iat, exp okunur.
 * Yeni token üretmez — sadece mevcut token'ı introspect eder.
 */

import type { FastifyInstance } from "fastify";
import { JwtService } from "../../services/jwtService.js";
import { config } from "../../config/env.js";

export async function adminMeRoute(server: FastifyInstance) {
  const jwtService = new JwtService(config.JWT_SECRET);

  server.get(
    "/admin/me",
    {
      schema: {
        description: "Get current admin user info from token.",
        tags: ["auth"],
        security: [{ bearerAuth: [] }],
        response: {
          200: {
            type: "object",
            properties: {
              email: { type: "string" },
              role: { type: "string" },
              iat: { type: "number" },
              exp: { type: "number" },
            },
          },
        },
      },
    },
    async (req, reply) => {
      // Token doğrulama — decorator yerine inline (auth route scope'unda decorator erişimi yok)
      const auth = req.headers.authorization;
      if (!auth?.startsWith("Bearer ")) {
        return reply.status(401).send({ error: "Missing authorization token" });
      }

      const token = auth.slice(7);
      const payload = await jwtService.verify(token);
      if (!payload || payload.role !== "admin") {
        return reply.status(403).send({ error: "Admin access required" });
      }

      return reply.send({
        email: payload.email ?? null,
        role: payload.role,
        iat: payload.iat,
        exp: payload.exp,
      });
    }
  );
}