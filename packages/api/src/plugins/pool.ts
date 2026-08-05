/**
 * Pool Plugin — postgres.js connection pool'larını yönetir.
 * Her DB için lazy pool: ilk istek geldiğinde açılır, idle'da kapatılır.
 * PoolManager singleton'ı Fastify decorator olarak `server.poolManager` üzerinden erişilir.
 */

import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";
import { PoolManager } from "../services/poolManager.js";
import { config } from "../config/env.js";

declare module "fastify" {
  interface FastifyInstance {
    poolManager: PoolManager;
  }
}

export const poolPlugin = fp(async (server: FastifyInstance) => {
  const manager = new PoolManager({
    host: config.PG_HOST,
    port: config.PG_PORT,
    user: config.PG_USER,
    password: config.PG_PASSWORD,
    ssl: config.PG_SSL,
    maxPoolSize: config.PG_MAX_POOL_SIZE,
    idleTimeout: config.PG_POOL_IDLE_TIMEOUT,
    maxLifetime: config.PG_POOL_MAX_LIFETIME,
  });

  server.decorate("poolManager", manager);

  // Sunucu kapanırken tüm pool'ları düzgünce kapat
  server.addHook("onClose", async () => {
    await manager.closeAll();
    server.log.info("All DB pools closed");
  });
});