/**
 * Admin session yönetimi.
 *
 *   GET    /auth/admin/sessions           — tüm aktif refresh session'larını listele
 *   DELETE /auth/admin/sessions/:token    — belirli bir session'ı revoke et
 *   DELETE /auth/admin/sessions           — tüm session'ları revoke et (force logout)
 *
 * Tüm endpoint'ler admin token gerektirir.
 * Redis yoksa 503 döner.
 */

import type { FastifyInstance } from "fastify";

async function requireAdmin(server: FastifyInstance, req: import("fastify").FastifyRequest, reply: import("fastify").FastifyReply): Promise<boolean> {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) {
    await reply.status(401).send({ error: "Missing authorization token" });
    return false;
  }
  const payload = await server.jwtService.verifyAdminOrDb(auth.slice(7));
  if (!payload || payload.role !== "admin") {
    await reply.status(403).send({ error: "Admin access required" });
    return false;
  }
  return true;
}

export async function adminSessionsRoute(server: FastifyInstance) {
  // ── GET /admin/sessions ──────────────────────────────────────────────────
  server.get(
    "/admin/sessions",
    {
      schema: {
        description: "List all active admin refresh sessions.",
        tags: ["auth"],
        security: [{ bearerAuth: [] }],
        response: {
          200: {
            type: "object",
            properties: {
              sessions: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    token:     { type: "string", description: "İlk 8 karakter + *** (kısaltılmış)" },
                    email:     { type: "string" },
                    createdAt: { type: "number" },
                    ttl:       { type: "number", description: "Saniye cinsinden kalan süre" },
                  },
                },
              },
              total: { type: "number" },
            },
          },
        },
      },
    },
    async (req, reply) => {
      if (!await requireAdmin(server, req, reply)) return;

      if (!server.sessionService.isAvailable) {
        return reply.status(503).send({
          error: "Session store unavailable",
          message: "REDIS_URL is not configured",
        });
      }

      const all = await server.sessionService.listAll();

      // Token'ın tamamını döndürme — kısalt (güvenlik)
      const sessions = all
        .map((s) => ({
          token:     `${s.token.slice(0, 8)}***`,
          email:     s.data.email,
          createdAt: s.data.createdAt,
          ttl:       s.ttl,
        }))
        .sort((a, b) => b.createdAt - a.createdAt);

      return reply.send({ sessions, total: sessions.length });
    }
  );

  // ── DELETE /admin/sessions/:token ────────────────────────────────────────
  server.delete(
    "/admin/sessions/:token",
    {
      schema: {
        description: "Revoke a specific refresh session by full token value.",
        tags: ["auth"],
        security: [{ bearerAuth: [] }],
        params: {
          type: "object",
          required: ["token"],
          properties: {
            token: { type: "string" },
          },
        },
      },
    },
    async (req, reply) => {
      if (!await requireAdmin(server, req, reply)) return;

      if (!server.sessionService.isAvailable) {
        return reply.status(503).send({
          error: "Session store unavailable",
          message: "REDIS_URL is not configured",
        });
      }

      const { token } = req.params as { token: string };
      await server.sessionService.revoke(token);
      return reply.status(204).send();
    }
  );

  // ── DELETE /admin/sessions ───────────────────────────────────────────────
  server.delete(
    "/admin/sessions",
    {
      schema: {
        description: "Revoke ALL active refresh sessions (force logout everyone).",
        tags: ["auth"],
        security: [{ bearerAuth: [] }],
        response: {
          200: {
            type: "object",
            properties: {
              revoked: { type: "number" },
            },
          },
        },
      },
    },
    async (req, reply) => {
      if (!await requireAdmin(server, req, reply)) return;

      if (!server.sessionService.isAvailable) {
        return reply.status(503).send({
          error: "Session store unavailable",
          message: "REDIS_URL is not configured",
        });
      }

      const all = await server.sessionService.listAll();
      for (const s of all) {
        await server.sessionService.revoke(s.token);
      }

      return reply.send({ revoked: all.length });
    }
  );
}