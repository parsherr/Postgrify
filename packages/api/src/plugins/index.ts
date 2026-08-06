/**
 * Tüm Fastify plugin'lerini tek noktadan kayıt eder.
 * Sıra önemlidir: cors → rateLimit → auth → cache
 */

import type { FastifyInstance } from "fastify";
import { corsPlugin } from "./cors.js";
import { rateLimitPlugin } from "./rateLimit.js";
import { authPlugin } from "./auth.js";
import { cachePlugin } from "./cache.js";
import { sessionPlugin } from "./session.js";
import { poolPlugin } from "./pool.js";
import { openApiPlugin } from "./openApi.js";
import { websocketPlugin } from "./websocket.js";

export async function registerPlugins(server: FastifyInstance) {
  await server.register(corsPlugin);
  await server.register(rateLimitPlugin);
  await server.register(authPlugin);
  await server.register(cachePlugin);
  await server.register(sessionPlugin);
  await server.register(poolPlugin);
  await server.register(websocketPlugin);
  await server.register(openApiPlugin);
}