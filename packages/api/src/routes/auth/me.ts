/**
 * GET /auth/admin/me — Returns current admin user information.
 *
 * Reads email, role, iat, and exp from the token payload.
 * Does not issue a new token — only introspects the current one.
 */

import type { FastifyInstance } from "fastify";

export async function adminMeRoute(server: FastifyInstance) {
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
              role:  { type: "string" },
              iat:   { type: "number" },
              exp:   { type: "number" },
            },
          },
        },
      },
    },
    async (req, reply) => {
      const auth = req.headers.authorization;
      if (!auth?.startsWith("Bearer ")) {
        return reply.status(401).send({ error: "Missing authorization token" });
      }

      const token = auth.slice(7);
      const payload = await server.jwtService.verifyAdminOrDb(token);
      if (!payload || payload.role !== "admin") {
        return reply.status(403).send({ error: "Admin access required" });
      }

      return reply.send({
        email: payload.email ?? null,
        role:  payload.role,
        iat:   payload.iat,
        exp:   payload.exp,
      });
    }
  );
}