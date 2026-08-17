/**
 * Groups admin routes. All routes require an admin token.
 */

import type { FastifyInstance } from "fastify";
import { databasesRoute } from "./databases.js";
import { statsRoute } from "./stats.js";
import { adminBackupRoute } from "./backup.js";
import { ipAllowlistRoutes } from "./ipAllowlist.js";

export async function adminRoutes(server: FastifyInstance) {
  // Apply authenticateAdmin hook to all admin routes
  server.addHook("preHandler", server.authenticateAdmin);

  await server.register(databasesRoute);
  await server.register(statsRoute);
  await server.register(adminBackupRoute);
  await server.register(ipAllowlistRoutes);
}