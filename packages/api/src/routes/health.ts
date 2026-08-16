/**
 * Health check endpoint — auth gerektirmez.
 * Docker / load balancer liveness probe için kullanılır.
 *
 * Güvenlik: Public endpoint olduğundan minimal bilgi döner.
 * Uptime, pool sayısı, versiyon gibi servis detayları burada açıklanmaz —
 * saldırgana hedefli exploit bilgisi vermemek için.
 *
 * Detaylı durum için: GET /admin/health (admin token gerektirir)
 * Readiness: GET /ready ve GET /health/ready (E-25) — Postgres ping
 */

import type { FastifyInstance, FastifyReply } from "fastify";

const READY_PROBE_DB = "postgres";

async function readinessHandler(server: FastifyInstance, reply: FastifyReply) {
  try {
    const sql = server.poolManager.getPool(READY_PROBE_DB);
    await sql`SELECT 1 AS ok`;

    // Aktif (lazy) pool'lar varsa onları da doğrula — stale bağlantı yakala.
    for (const dbName of server.poolManager.activePoolNames) {
      if (dbName === READY_PROBE_DB) continue;
      const pool = server.poolManager.getPool(dbName);
      await pool`SELECT 1 AS ok`;
    }

    return reply.status(200).send({ ready: true });
  } catch {
    return reply.status(503).send({ ready: false });
  }
}

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

  // ── E-25 Readiness (Kubernetes / Docker) ───────────────────────────────────
  const readySchema = {
    description:
      "Readiness probe (E-25). 200 when Postgres accepts connections; 503 otherwise.",
    tags: ["system"],
    security: [],
    response: {
      200: {
        type: "object",
        properties: { ready: { type: "boolean" } },
      },
      503: {
        type: "object",
        properties: { ready: { type: "boolean" } },
      },
    },
  };

  server.get("/ready", { schema: readySchema }, async (_req, reply) =>
    readinessHandler(server, reply)
  );
  server.get("/health/ready", { schema: readySchema }, async (_req, reply) =>
    readinessHandler(server, reply)
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
