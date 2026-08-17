/**
 * Pool Plugin — manages postgres.js connection pools.
 * Lazy pool per DB: opened on first request, closed after idle timeout.
 * The PoolManager singleton is exposed as a Fastify decorator via `server.poolManager`.
 *
 * Also initialises SettingsService, BackupService, and BackupScheduler, exposed
 * as `server.settings`, `server.backupService`, and `server.backupScheduler`.
 *
 * onReady:
 *   1. Admin credentials are loaded from the DB → injected into config (recovers
 *      ADMIN_EMAIL/ADMIN_PASSWORD_HASH lost from process.env after a Docker restart)
 *   2. Auto-start DBs are opened
 *   3. Backup schedules are loaded
 *
 * onClose: all pools + backup scheduler are closed gracefully.
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

  // SettingsService: use the postgres DB as the metadata store
  const metaSql = manager.getPool("postgres");
  const settingsSvc = new SettingsService(metaSql);
  server.decorate("settings", settingsSvc);

  // BackupService: same postgres metadata DB, reads from BACKUP_DIR
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

  // Perform all startup tasks in order once the server is fully ready
  server.addHook("onReady", async () => {
    // ── Step 1: Load admin credentials from DB ────────────────────────────────
    // When writing to .env fails inside a Docker container, credentials are only
    // injected into process.env at runtime. They are lost after a container restart.
    // The record in the DB persists in the volume — reloading from here ensures
    // login continues to work.
    if (!config.ADMIN_EMAIL || !config.ADMIN_PASSWORD_HASH) {
      try {
        const creds = await settingsSvc.getAdminCredentials();
        if (creds) {
          // The config object is not frozen by Zod; runtime injection is safe
          (config as Record<string, unknown>).ADMIN_EMAIL = creds.email;
          (config as Record<string, unknown>).ADMIN_PASSWORD_HASH = creds.passwordHash;
          // Also update process.env: adminLogin.ts reads from process.env directly
          process.env.ADMIN_EMAIL = creds.email;
          process.env.ADMIN_PASSWORD_HASH = creds.passwordHash;
          server.log.info("Admin credentials loaded from DB (container restart recovery)");
        }
      } catch (err) {
        server.log.warn({ err }, "Could not load admin credentials from DB — login may fail");
      }
    }

    // ── Step 2: Auto-start pools ──────────────────────────────────────────────
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

    // ── Step 3: Backup schedules ──────────────────────────────────────────────
    try {
      await scheduler.load();
    } catch (err) {
      server.log.warn({ err }, "Could not load backup schedules");
    }
  });

  // Close all pools and the scheduler gracefully when the server shuts down
  server.addHook("onClose", async () => {
    scheduler.stop();
    await manager.closeAll();
    server.log.info("All DB pools closed");
  });
});