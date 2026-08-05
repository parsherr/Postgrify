/**
 * Tüm route gruplarını tek noktadan kayıt eder.
 */

import type { FastifyInstance } from "fastify";
import { adminRoutes } from "./admin/index.js";
import { authRoutes } from "./auth/index.js";
import { dbRoutes } from "./db/index.js";
import { healthRoute } from "./health.js";

export async function registerRoutes(server: FastifyInstance) {
  await server.register(healthRoute);
  await server.register(authRoutes, { prefix: "/auth" });
  await server.register(adminRoutes, { prefix: "/admin" });
  await server.register(dbRoutes, { prefix: "/db" });
}