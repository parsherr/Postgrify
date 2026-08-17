/**
 * Cache Plugin — Redis or in-memory LRU cache.
 * Uses Redis when a Redis URL is configured, otherwise falls back to in-memory automatically.
 * Accessible via the `server.cache` decorator.
 */

import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";
import { CacheService } from "../services/cacheService.js";
import { config } from "../config/env.js";

declare module "fastify" {
  interface FastifyInstance {
    cache: CacheService;
  }
}

export const cachePlugin = fp(async (server: FastifyInstance) => {
  const cache = new CacheService(config.REDIS_URL);
  await cache.connect();

  server.decorate("cache", cache);

  server.addHook("onClose", async () => {
    await cache.disconnect();
  });

  server.log.info(
    config.REDIS_URL ? "Cache: Redis connected" : "Cache: in-memory LRU active"
  );
});