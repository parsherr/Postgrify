/**
 * Auth route'larını gruplar.
 */

import type { FastifyInstance } from "fastify";
import { tokenRoute } from "./token.js";
import { adminTokenRoute } from "./adminToken.js";

export async function authRoutes(server: FastifyInstance) {
  await server.register(tokenRoute);
  await server.register(adminTokenRoute);
}
