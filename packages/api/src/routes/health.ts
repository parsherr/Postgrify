/**
 * Health check endpoint — auth gerektirmez.
 * Docker / load balancer liveness probe için kullanılır.
 *
 * Güvenlik: Public endpoint olduğundan minimal bilgi döner.
 * Uptime, pool sayısı, versiyon gibi servis detayları burada açıklanmaz —
 * saldırgana hedefli exploit bilgisi vermemek için.
 *
 * Detaylı durum için: GET /admin/health (admin token gerektirir)
 */

import type { FastifyInstance } from "fastify";

export async function healthRoute(server: FastifyInstance) {
  // ── Public health check ────────────────────────────────────────────────────
  server.get(
    "/health",
    {
      schema: {
        description: "Service liveness check — returns ok when API is running.",
        tags: ["system"],
        security: [],
        response: {
          200: {
            type: "object",
            properties: {
              ok: { type: "boolean" },
            },
          },
        },
      },
    },
    async (_req, reply) => {
      return reply.send({ ok: true });
    }
  );

  // ── Admin health check — detaylı durum ────────────────────────────────────
  // authenticateAdmin decorator'ı auth plugin tarafından eklenir; yoksa bu
  // endpoint kayıt edilmez (test ortamında minimal server'da güvenli skip).
  if (typeof server.authenticateAdmin === "function") {
    server.get(
      "/admin/health",
      {
        schema: {
          description: "Detailed service health — requires admin token.",
          tags: ["admin"],
          security: [{ bearerAuth: [] }],
          response: {
            200: {
              type: "object",
              properties: {
                ok:          { type: "boolean" },
                uptime:      { type: "number" },
                activePools: { type: "number" },
              },
            },
          },
        },
        preHandler: [server.authenticateAdmin],
      },
      async (_req, reply) => {
        return reply.send({
          ok:          true,
          uptime:      process.uptime(),
          activePools: server.poolManager.activePoolCount,
        });
      }
    );
  }
}