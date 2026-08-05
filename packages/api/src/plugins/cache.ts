/**
 * Cache Plugin — Redis veya in-memory LRU cache.
 * Redis URL varsa Redis, yoksa otomatik olarak in-memory devreye girer.
 * `server.cache` decorator'ı üzerinden erişilir.
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