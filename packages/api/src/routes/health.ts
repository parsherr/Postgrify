/**
 * Health check endpoint — auth gerektirmez.
 * Docker / load balancer liveness probe için kullanılır.
 */

import type { FastifyInstance } from "fastify";

export async function healthRoute(server: FastifyInstance) {
  server.get(
    "/health",
    {
      schema: {
        description: "Service health check",
        tags: ["system"],
        response: {
          200: {
            type: "object",
            properties: {
              status: { type: "string" },
              uptime: { type: "number" },
              activePools: { type: "number" },
            },
          },
        },
      },
    },
    async (_req, reply) => {
      return reply.send({
        status: "ok",
        uptime: process.uptime(),
        activePools: server.poolManager.activePoolCount,
      });
    }
  );
}