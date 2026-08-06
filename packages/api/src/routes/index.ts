/**
 * Tüm route gruplarını tek noktadan kayıt eder.
 */

import type { FastifyInstance } from "fastify";
import { adminRoutes } from "./admin/index.js";
import { authRoutes } from "./auth/index.js";
import { dbRoutes } from "./db/index.js";
import { authDbRoutes } from "./db/auth/index.js";
import { healthRoute } from "./health.js";
import { setupRoutes } from "./setup.js";
import { terminalRoutes } from "./terminal.js";

export async function registerRoutes(server: FastifyInstance) {
  await server.register(healthRoute);
  await server.register(setupRoutes, { prefix: "/setup" });
  await server.register(authRoutes, { prefix: "/auth" });
  await server.register(adminRoutes, { prefix: "/admin" });
  await server.register(dbRoutes, { prefix: "/db" });
  await server.register(terminalRoutes, { prefix: "/terminal" });
  // DB-level auth: /db/:database/auth/* — dbResolver only, no global authenticate
  await server.register(authDbRoutes, { prefix: "/db" });
}