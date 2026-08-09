/**
 * Pool Plugin — postgres.js connection pool'larını yönetir.
 * Her DB için lazy pool: ilk istek geldiğinde açılır, idle'da kapatılır.
 * PoolManager singleton'ı Fastify decorator olarak `server.poolManager` üzerinden erişilir.
 *
 * Ayrıca SettingsService, BackupService ve BackupScheduler'ı başlatır ve
 * sırasıyla `server.settings`, `server.backupService`, `server.backupScheduler`
 * olarak expose eder.
 *
 * onReady:
 *   1. DB'den admin credentials yüklenir → config'e inject edilir (Docker restart sonrası
 *      process.env'de kaybolmuş ADMIN_EMAIL/ADMIN_PASSWORD_HASH yeniden elde edilir)
 *   2. auto_start DB'leri açılır
 *   3. backup schedule'ları yüklenir
 *
 * onClose: tüm pool'lar + backup scheduler düzgünce kapatılır.
 */

import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";
import { PoolManager } from "../services/poolManager.js";
import { SettingsService } from "../services/settingsService.js";
import { BackupService } from "../services/backupService.js";
import { BackupScheduler } from "../services/backupScheduler.js";
import { config } from "../config/env.js";

declare module "fastify" {
  interface FastifyInstance {
    poolManager: PoolManager;
    settings: SettingsService;
    backupService: BackupService;
    backupScheduler: BackupScheduler;
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

  // BackupService: aynı postgres meta-veri DB'si, BACKUP_DIR'den okur
  const backupSvc = new BackupService(metaSql, config.BACKUP_DIR);
  server.decorate("backupService", backupSvc);

  // BackupScheduler: settings + backupService + pool resolver
  const scheduler = new BackupScheduler(
    settingsSvc,
    backupSvc,
    (dbName) => manager.getPool(dbName),
    server.log,
  );
  server.decorate("backupScheduler", scheduler);

  // Sunucu tamamen hazır olduğunda tüm başlangıç işlemlerini sırayla yap
  server.addHook("onReady", async () => {
    // ── Adım 1: Admin credentials'ı DB'den yükle ─────────────────────────────
    // Docker container'da .env dosyasına yazma başarısız olduğunda process.env'e
    // sadece runtime inject yapılır. Container restart'ta bu kaybolur.
    // DB'deki kayıt volume'da kalıcıdır — buradan yeniden yüklenerek login'in
    // çalışmaya devam etmesi sağlanır.
    if (!config.ADMIN_EMAIL || !config.ADMIN_PASSWORD_HASH) {
      try {
        const creds = await settingsSvc.getAdminCredentials();
        if (creds) {
          // config nesnesi Zod tarafından dondurulmuş değil; runtime inject güvenli
          (config as Record<string, unknown>).ADMIN_EMAIL = creds.email;
          (config as Record<string, unknown>).ADMIN_PASSWORD_HASH = creds.passwordHash;
          // process.env'i de güncelle: adminLogin.ts doğrudan process.env okur
          process.env.ADMIN_EMAIL = creds.email;
          process.env.ADMIN_PASSWORD_HASH = creds.passwordHash;
          server.log.info("Admin credentials loaded from DB (container restart recovery)");
        }
      } catch (err) {
        server.log.warn({ err }, "Could not load admin credentials from DB — login may fail");
      }
    }

    // ── Adım 2: Auto-start pools ──────────────────────────────────────────────
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

    // ── Adım 3: Backup schedules ──────────────────────────────────────────────
    try {
      await scheduler.load();
    } catch (err) {
      server.log.warn({ err }, "Could not load backup schedules");
    }
  });

  // Sunucu kapanırken tüm pool'ları ve scheduler'ı düzgünce kapat
  server.addHook("onClose", async () => {
    scheduler.stop();
    await manager.closeAll();
    server.log.info("All DB pools closed");
  });
});