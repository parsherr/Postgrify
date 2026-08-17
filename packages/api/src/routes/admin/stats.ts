/**
 * GET /admin/stats — Service-wide statistics.
 * Active pool count, total DB size, uptime.
 */

import type { FastifyInstance } from "fastify";
import { asyncHandler } from "../../utils/asyncHandler.js";

export async function statsRoute(server: FastifyInstance) {
  server.get(
    "/stats",
    {
      // Security: admin statistics (active DB list, uptime, Node version)
      // must require authentication — risk of information leakage.
      preHandler: [server.authenticateAdmin],
      schema: {
        description: "Service-wide statistics (requires admin token)",
        tags: ["admin"],
        security: [{ bearerAuth: [] }],
      },
    },
    asyncHandler(async (_req, reply) => {
      const sql = server.poolManager.getPool("postgres");

      const [sizeResult] = await sql`
        SELECT sum(pg_database_size(datname)) AS total_bytes
        FROM pg_database
        WHERE datistemplate = false AND datname != 'postgres'
      `;

      return reply.send({
        uptime: process.uptime(),
        activePools: server.poolManager.activePoolCount,
        activePoolNames: server.poolManager.activePoolNames,
        totalSizeBytes: Number(sizeResult.total_bytes ?? 0),
        nodeVersion: process.version,
      });
    })
  );
}