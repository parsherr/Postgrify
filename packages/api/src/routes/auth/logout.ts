/**
 * POST /auth/admin/logout — Refresh token'ı revoke eder.
 *
 * Authorization: Bearer <accessToken> header'ı zorunludur.
 * Body'deki refreshToken Redis'ten silinir.
 * Redis yoksa 204 döner (idempotent).
 */

import type { FastifyInstance } from "fastify";

export async function adminLogoutRoute(server: FastifyInstance) {
  server.post(
    "/admin/logout",
    {
      schema: {
        description: "Revoke the refresh token and end the session.",
        tags: ["auth"],
        security: [{ bearerAuth: [] }],
        body: {
          type: "object",
          required: ["refreshToken"],
          properties: {
            refreshToken: { type: "string" },
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

      const { refreshToken } = req.body as { refreshToken: string };
      await server.sessionService.revoke(refreshToken);

      return reply.status(204).send();
    }
  );
}