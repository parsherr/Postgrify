/**
 * Backup Scheduler — manages scheduled backup jobs.
 *
 * One node-cron job is maintained per DB.
 * Schedule configuration is read from and written to SettingsService.
 * Jobs are stopped when the server shuts down (`stop()`).
 *
 * Lifecycle:
 *   1. `load()` — reads all current schedules from the DB and starts the jobs.
 *      Called from the pool plugin's `onReady` hook.
 *   2. `scheduleBackup()` / `cancelSchedule()` — updated at runtime.
 *   3. `stop()` — stops all jobs in onClose.
 */

import * as cron from "node-cron";
import type { SettingsService, BackupScheduleConfig } from "./settingsService.js";
import type { BackupService } from "./backupService.js";
import type postgres from "postgres";

// Get the node-cron ScheduledTask type directly
type ScheduledTask = ReturnType<typeof cron.schedule>;

// Pool resolver: dbName → postgres.Sql
type PoolResolver = (dbName: string) => postgres.Sql;

// Minimal Pino-compatible logger interface
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
   * Reads all active schedules from SettingsService and starts the jobs.
   * Called once when the server is ready.
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
   * Enables the schedule for a specific DB.
   * If a job was already defined for this DB, it is stopped and replaced.
   */
  scheduleBackup(dbName: string, config: BackupScheduleConfig): void {
    // Cancel the previous job
    this.cancelSchedule(dbName);

    if (!config.enabled) return;

    if (!cron.validate(config.cron)) {
      throw new Error(`Invalid cron expression for ${dbName}: "${config.cron}"`);
    }

    this.register(dbName, config);
    this.log.info({ dbName, cron: config.cron }, "Backup schedule registered");
  }

  /** Stops the schedule job for a specific DB. */
  cancelSchedule(dbName: string): void {
    const existing = this.jobs.get(dbName);
    if (existing) {
      existing.stop();
      this.jobs.delete(dbName);
      this.log.info({ dbName }, "Backup schedule cancelled");
    }
  }

  /** Returns the list of dbNames for active schedules. */
  activeSchedules(): string[] {
    return Array.from(this.jobs.keys());
  }

  /** Stops all jobs. Called when the server shuts down. */
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

      // Apply retention policy
      if (retain > 0) {
        await this.backupService.enforceRetention(dbName, retain);
      }
    } catch (err) {
      this.log.error({ err, dbName }, "Scheduled backup job threw");
    }
  }
}