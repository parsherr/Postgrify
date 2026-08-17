/**
 * Groups auth routes.
 */

import type { FastifyInstance } from "fastify";
import { tokenRoute } from "./token.js";
import { adminTokenRoute } from "./adminToken.js";
import { adminLoginRoute } from "./adminLogin.js";
import { adminRefreshRoute } from "./refresh.js";
import { adminLogoutRoute } from "./logout.js";
import { adminSessionsRoute } from "./sessions.js";
import { adminMeRoute } from "./me.js";

export async function authRoutes(server: FastifyInstance) {
  // Programmatic access (SDK, CI) — protected
  await server.register(tokenRoute);
  await server.register(adminTokenRoute);

  // GUI login flow
  await server.register(adminLoginRoute);
  await server.register(adminRefreshRoute);
  await server.register(adminLogoutRoute);
  await server.register(adminSessionsRoute);
  await server.register(adminMeRoute);
}
