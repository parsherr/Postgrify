/**
 * Admin route'larını gruplar. Tüm route'lar admin token gerektirir.
 */

import type { FastifyInstance } from "fastify";
import { databasesRoute } from "./databases.js";
import { statsRoute } from "./stats.js";

export async function adminRoutes(server: FastifyInstance) {
  // Tüm admin route'larına authenticateAdmin hook'u ekle
  server.addHook("preHandler", server.authenticateAdmin);

  await server.register(databasesRoute);
  await server.register(statsRoute);
}