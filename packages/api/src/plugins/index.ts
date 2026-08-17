/**
 * Registers all Fastify plugins from a single entry point.
 * Order matters: cors → rateLimit → auth → cache
 */

import type { FastifyInstance } from "fastify";
import { corsPlugin } from "./cors.js";
import { errorHandlerPlugin } from "./errorHandler.js";
import { rateLimitPlugin } from "./rateLimit.js";
import { authPlugin } from "./auth.js";
import { cachePlugin } from "./cache.js";
import { sessionPlugin } from "./session.js";
import { poolPlugin } from "./pool.js";
import { openApiPlugin } from "./openApi.js";
import { websocketPlugin } from "./websocket.js";

export async function registerPlugins(server: FastifyInstance) {
  // Error handler must be registered first — it also catches errors from other plugins
  await server.register(errorHandlerPlugin);
  await server.register(corsPlugin);
  await server.register(rateLimitPlugin);
  await server.register(authPlugin);
  await server.register(cachePlugin);
  await server.register(sessionPlugin);
  await server.register(poolPlugin);
  await server.register(websocketPlugin);
  await server.register(openApiPlugin);
}