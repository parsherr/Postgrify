/**
 * Backup Scheduler — Zamanlanmış backup job'larını yönetir.
 *
 * Her DB için bir node-cron job'u tutulur.
 * Schedule konfigürasyonu SettingsService üzerinden okunur/yazılır.
 * Job'lar sunucu kapanırken (`stop()`) durdurulur.
 *
 * Lifecycle:
 *   1. `load()` — mevcut tüm schedule'ları DB'den okuyup job'ları başlatır.
 *      Pool plugin'in `onReady` hook'unda çağrılır.
 *   2. `scheduleBackup()` / `cancelSchedule()` — runtime'da güncellenir.
 *   3. `stop()` — onClose'da tüm job'ları durdurur.
 */

import * as cron from "node-cron";
import type { SettingsService, BackupScheduleConfig } from "./settingsService.js";
import type { BackupService } from "./backupService.js";
import type postgres from "postgres";

// node-cron ScheduledTask tipini doğrudan al
type ScheduledTask = ReturnType<typeof cron.schedule>;

// Pool resolver: dbName → postgres.Sql
type PoolResolver = (dbName: string) => postgres.Sql;

// Pino-uyumlu minimal logger arayüzü
interface Logger {
  info(obj: object | string, msg?: string): void;
  warn(obj: object | string, msg?: string): void;
  error(obj: object | string, msg?: string): void;
}

export class BackupScheduler {
  private jobs = new Map<string, ScheduledTask>();

  constructor(
    private readonly settings: SettingsService,
    private readonly backupService: BackupService,
    private readonly getPool: PoolResolver,
    private readonly log: Logger,
  ) {}

  /**
   * Tüm aktif schedule'ları SettingsService'den okuyup job'ları başlatır.
   * Sunucu ready olduğunda bir kez çağrılır.
   */
  async load(): Promise<void> {
    const schedules = await this.settings.getAllBackupSchedules();
    for (const [dbName, config] of Object.entries(schedules)) {
      if (config.enabled) {
        this.register(dbName, config);
      }
    }
    this.log.info(
      { count: Object.keys(schedules).length },
      "Backup schedules loaded"
    );
  }

  /**
   * Belirli bir DB için schedule'ı etkinleştirir.
   * Aynı DB için daha önce tanımlı job varsa durdurulup yenisiyle değiştirilir.
   */
  scheduleBackup(dbName: string, config: BackupScheduleConfig): void {
    // Önceki job'u iptal et
    this.cancelSchedule(dbName);

    if (!config.enabled) return;

    if (!cron.validate(config.cron)) {
      throw new Error(`Invalid cron expression for ${dbName}: "${config.cron}"`);
    }

    this.register(dbName, config);
    this.log.info({ dbName, cron: config.cron }, "Backup schedule registered");
  }

  /** Belirli bir DB'nin schedule job'unu durdurur. */
  cancelSchedule(dbName: string): void {
    const existing = this.jobs.get(dbName);
    if (existing) {
      existing.stop();
      this.jobs.delete(dbName);
      this.log.info({ dbName }, "Backup schedule cancelled");
    }
  }

  /** Aktif schedule'ların dbName listesini döner. */
  activeSchedules(): string[] {
    return Array.from(this.jobs.keys());
  }

  /** Tüm job'ları durdurur. Sunucu kapanırken çağrılır. */
  stop(): void {
    for (const [dbName, job] of this.jobs.entries()) {
      job.stop();
      this.log.info({ dbName }, "Backup job stopped");
    }
    this.jobs.clear();
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private register(dbName: string, config: BackupScheduleConfig): void {
    const task = cron.schedule(config.cron, () => {
      this.runJob(dbName, config.retain).catch((err: unknown) => {
        this.log.error({ err, dbName }, "Scheduled backup failed");
      });
    });

    this.jobs.set(dbName, task);
  }

  private async runJob(dbName: string, retain: number): Promise<void> {
    this.log.info({ dbName }, "Scheduled backup starting");
    try {
      const sql = this.getPool(dbName);
      const result = await this.backupService.createBackup(dbName, sql);

      if (result.status === "failed") {
        this.log.error(
          { dbName, error: result.error_msg },
          "Scheduled backup completed with error"
        );
        return;
      }

      this.log.info({ dbName, id: result.id, sizeBytes: result.size_bytes }, "Scheduled backup completed");

      // Retention policy uygula
      if (retain > 0) {
        await this.backupService.enforceRetention(dbName, retain);
      }
    } catch (err) {
      this.log.error({ err, dbName }, "Scheduled backup job threw");
    }
  }
}