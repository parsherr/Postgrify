/**
 * Pool Plugin — postgres.js connection pool'larını yönetir.
 * Her DB için lazy pool: ilk istek geldiğinde açılır, idle'da kapatılır.
 * PoolManager singleton'ı Fastify decorator olarak `server.poolManager` üzerinden erişilir.
 *
 * Ayrıca SettingsService'i başlatır ve `server.settings` olarak expose eder.
 * Sunucu hazır olduğunda auto_start=true olan DB'lerin pool'ları otomatik açılır.
 */

import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";
import { PoolManager } from "../services/poolManager.js";
import { SettingsService } from "../services/settingsService.js";
import { config } from "../config/env.js";

declare module "fastify" {
  interface FastifyInstance {
    poolManager: PoolManager;
    settings: SettingsService;
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

  // SettingsService: postgres DB'sini meta-veri deposu olarak kullan
  const metaSql = manager.getPool("postgres");
  const settingsSvc = new SettingsService(metaSql);
  server.decorate("settings", settingsSvc);

  // Sunucu tamamen hazır olduğunda auto_start DB'lerini aç
  server.addHook("onReady", async () => {
    try {
      const autoStartDbs = await settingsSvc.getAutoStartDatabases();
      for (const dbName of autoStartDbs) {
        try {
          const sql = manager.getPool(dbName);
          await sql`SELECT 1`;
          server.log.info(`Auto-start pool opened: ${dbName}`);
        } catch (err) {
          server.log.warn({ err }, `Auto-start failed for DB: ${dbName}`);
        }
      }
    } catch (err) {
      server.log.warn({ err }, "Could not read auto-start settings");
    }
  });

  // Sunucu kapanırken tüm pool'ları düzgünce kapat
  server.addHook("onClose", async () => {
    await manager.closeAll();
    server.log.info("All DB pools closed");
  });
});