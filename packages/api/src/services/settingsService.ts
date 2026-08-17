/**
 * Settings Service — persists Postgrify metadata in PostgreSQL.
 *
 * The `_postgrify_settings` table is used as a key-value store.
 * The table is automatically provisioned on first call if it does not exist.
 *
 * Saklanan key'ler:
 *   admin_setup_completed    → "true"
 *   admin_email              → admin e-posta adresi
 *   admin_password_hash      → argon2id hash
 *   autoStartDatabases       → JSON string[] (databases to auto-start)
 *   backup_schedules         → JSON (BackupScheduleConfig map)
 *   ip_allowlist:<dbName>    → JSON (IpAllowlistConfig)
 */

import type { Sql } from "postgres";
import type { IpAllowlistConfig } from "../utils/ipUtils.js";

export type { IpAllowlistConfig };

// ─── Tipler ──────────────────────────────────────────────────────────────────

/** Backup schedule configuration — automatic backup settings for a single DB. */
export interface BackupScheduleConfig {
  /** Cron expression — e.g. "0 2 * * *" */
  cron: string;
  enabled: boolean;
  retain: number;
}

/** Admin credentials — loaded from the DB. */
export interface AdminCredentials {
  email: string;
  passwordHash: string;
}

// ─── Servis ───────────────────────────────────────────────────────────────────

export class SettingsService {
  /** Promise that resolves when provisioning completes. */
  private ready: Promise<void> | null = null;

  constructor(private readonly sql: Sql) {}

  // ── Provision ─────────────────────────────────────────────────────────────

  private ensureReady(): Promise<void> {
    if (!this.ready) {
      this.ready = this.provision().catch((err) => {
        // If provisioning fails, retry on the next call
        this.ready = null;
        throw err;
      });
    }
    return this.ready;
  }

  private async provision(): Promise<void> {
    await this.sql`
      CREATE TABLE IF NOT EXISTS _postgrify_settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `;
  }

  // ── Auto-start databases ───────────────────────────────────────────────────

  /** Returns the list of DBs to be auto-opened at server startup. */
  async getAutoStartDatabases(): Promise<string[]> {
    await this.ensureReady();
    const rows = await this.sql<{ value: string }[]>`
      SELECT value FROM _postgrify_settings
      WHERE key = 'autoStartDatabases'
      LIMIT 1
    `;
    if (!rows[0]?.value) return [];
    try {
      return JSON.parse(rows[0].value) as string[];
    } catch {
      return [];
    }
  }

  /** Updates the list of DBs to be auto-started. */
  async setAutoStartDatabases(databases: string[]): Promise<void> {
    await this.ensureReady();
    const value = JSON.stringify(databases);
    await this.sql`
      INSERT INTO _postgrify_settings (key, value)
      VALUES ('autoStartDatabases', ${value})
      ON CONFLICT (key) DO UPDATE SET value = ${value}
    `;
  }

  // ── Backup schedules ───────────────────────────────────────────────────────

  /** Returns all backup schedule configurations: { dbName → config } */
  async getAllBackupSchedules(): Promise<Record<string, BackupScheduleConfig>> {
    await this.ensureReady();
    const rows = await this.sql<{ value: string }[]>`
      SELECT value FROM _postgrify_settings
      WHERE key = 'backup_schedules'
      LIMIT 1
    `;
    if (!rows[0]?.value) return {};
    try {
      return JSON.parse(rows[0].value) as Record<string, BackupScheduleConfig>;
    } catch {
      return {};
    }
  }

  /** Returns the backup schedule for a specific DB. Returns null if not found. */
  async getBackupSchedule(dbName: string): Promise<BackupScheduleConfig | null> {
    const schedules = await this.getAllBackupSchedules();
    return schedules[dbName] ?? null;
  }

  /** Saves or updates the backup schedule for a DB. */
  async setBackupSchedule(dbName: string, config: BackupScheduleConfig): Promise<void> {
    const schedules = await this.getAllBackupSchedules();
    schedules[dbName] = config;
    const value = JSON.stringify(schedules);
    await this.sql`
      INSERT INTO _postgrify_settings (key, value)
      VALUES ('backup_schedules', ${value})
      ON CONFLICT (key) DO UPDATE SET value = ${value}
    `;
  }

  /** Deletes the backup schedule for a DB. */
  async deleteBackupSchedule(dbName: string): Promise<void> {
    const schedules = await this.getAllBackupSchedules();
    if (!(dbName in schedules)) return;
    delete schedules[dbName];
    const value = JSON.stringify(schedules);
    await this.sql`
      INSERT INTO _postgrify_settings (key, value)
      VALUES ('backup_schedules', ${value})
      ON CONFLICT (key) DO UPDATE SET value = ${value}
    `;
  }

  // ── IP allowlist ───────────────────────────────────────────────────────────

  /**
   * Reads the IP allowlist for a DB.
   * Returns the default (everyone, empty list) if the setting is not found.
   */
  async getIpAllowlist(dbName: string): Promise<IpAllowlistConfig> {
    await this.ensureReady();
    const key = `ip_allowlist:${dbName}`;
    const rows = await this.sql<{ value: string }[]>`
      SELECT value FROM _postgrify_settings WHERE key = ${key} LIMIT 1
    `;
    if (!rows[0]?.value) return { mode: "everyone", ips: [] };
    try {
      return JSON.parse(rows[0].value) as IpAllowlistConfig;
    } catch {
      return { mode: "everyone", ips: [] };
    }
  }

  /** Saves the IP allowlist for a DB. */
  async setIpAllowlist(dbName: string, config: IpAllowlistConfig): Promise<void> {
    await this.ensureReady();
    const key = `ip_allowlist:${dbName}`;
    const value = JSON.stringify(config);
    await this.sql`
      INSERT INTO _postgrify_settings (key, value)
      VALUES (${key}, ${value})
      ON CONFLICT (key) DO UPDATE SET value = ${value}
    `;
  }

  /** Deletes the IP allowlist for a DB (reverts to everyone mode). */
  async deleteIpAllowlist(dbName: string): Promise<void> {
    await this.ensureReady();
    await this.sql`
      DELETE FROM _postgrify_settings WHERE key = ${"ip_allowlist:" + dbName}
    `;
  }

  // ── Admin setup flag ───────────────────────────────────────────────────────

  /**
   * Checks whether the admin setup completion record exists in the DB.
   * Returns false if the table does not exist or a connection error occurs (does not throw).
   */
  async getAdminSetupCompleted(): Promise<boolean> {
    await this.ensureReady();
    const rows = await this.sql<{ value: string }[]>`
      SELECT value FROM _postgrify_settings
      WHERE key = 'admin_setup_completed'
      LIMIT 1
    `;
    return rows[0]?.value === "true";
  }

  /**
   * Writes the admin setup completion record to the DB.
   * Called on successful POST /setup.
   */
  async setAdminSetupCompleted(): Promise<void> {
    await this.ensureReady();
    await this.sql`
      INSERT INTO _postgrify_settings (key, value)
      VALUES ('admin_setup_completed', 'true')
      ON CONFLICT (key) DO UPDATE SET value = 'true'
    `;
  }

  // ── Admin credentials ──────────────────────────────────────────────────────

  /**
   * Persists admin credentials to the DB.
   *
   * This method is used when writing to `.env` fails inside a Docker container.
   * Credentials are stored persistently in the PostgreSQL volume and survive
   * container restarts.
   *
   * Keys are passed as parameters — in mocks args[1]=key, args[2]=value
   * olarak kolayca okunabilir.
   */
  async setAdminCredentials(email: string, passwordHash: string): Promise<void> {
    await this.ensureReady();

    const emailKey = "admin_email";
    const hashKey = "admin_password_hash";
    await this.sql`
      INSERT INTO _postgrify_settings (key, value)
      VALUES (${emailKey}, ${email})
      ON CONFLICT (key) DO UPDATE SET value = ${email}
    `;
    await this.sql`
      INSERT INTO _postgrify_settings (key, value)
      VALUES (${hashKey}, ${passwordHash})
      ON CONFLICT (key) DO UPDATE SET value = ${passwordHash}
    `;
  }

  /**
   * Loads admin credentials from the DB.
   * Returns null if email or hash is missing.
   */
  async getAdminCredentials(): Promise<AdminCredentials | null> {
    await this.ensureReady();
    const rows = await this.sql<{ key: string; value: string }[]>`
      SELECT key, value FROM _postgrify_settings
      WHERE key IN ('admin_email', 'admin_password_hash')
    `;
    const map = new Map(rows.map((r) => [r.key, r.value]));
    const email = map.get("admin_email");
    const passwordHash = map.get("admin_password_hash");
    if (!email || !passwordHash) return null;
    return { email, passwordHash };
  }

  // ── Database deletion helper ──────────────────────────────────────────────

  /**
   * Clears all settings related to a DB when it is deleted.
   * (backup_schedule + ip_allowlist)
   */
  async deleteDatabase(dbName: string): Promise<void> {
    await this.deleteBackupSchedule(dbName);
    await this.deleteIpAllowlist(dbName);
  }
}