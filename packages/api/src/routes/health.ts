/**
 * Health check endpoint — no auth required.
 * Used as a Docker / load balancer liveness probe.
 *
 * Security: returns minimal information because this is a public endpoint.
 * Service details such as uptime, pool count, and version are omitted
 * to avoid giving an attacker targeted exploit information.
 *
 * For detailed status: GET /admin/health (requires admin token)
 * Readiness: GET /ready and GET /health/ready (E-25) — Postgres ping
 */

import type { FastifyInstance, FastifyReply } from "fastify";

const READY_PROBE_DB = "postgres";

async function readinessHandler(server: FastifyInstance, reply: FastifyReply) {
  try {
    const sql = server.poolManager.getPool(READY_PROBE_DB);
    await sql`SELECT 1 AS ok`;

    // Also verify active (lazy) pools if any — catch stale connections.
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

  // ── Admin health check — detailed status ────────────────────────────────────
  // The authenticateAdmin decorator is added by the auth plugin; if absent this
  // endpoint is not registered (safe skip on a minimal test server).
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
