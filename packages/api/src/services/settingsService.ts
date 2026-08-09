/**
 * Settings Service — Postgrify meta-verilerini PostgreSQL'de kalıcı olarak saklar.
 *
 * `_postgrify_settings` tablosu key-value deposu olarak kullanılır.
 * Tablo yoksa ilk çağrıda otomatik oluşturulur (provision).
 *
 * Saklanan key'ler:
 *   admin_setup_completed    → "true"
 *   admin_email              → admin e-posta adresi
 *   admin_password_hash      → argon2id hash
 *   autoStartDatabases       → JSON string[] (otomatik başlatılacak DB'ler)
 *   backup_schedules         → JSON (BackupScheduleConfig haritası)
 *   ip_allowlist:<dbName>    → JSON (IpAllowlistConfig)
 */

import type { Sql } from "postgres";
import type { IpAllowlistConfig } from "../utils/ipUtils.js";

export type { IpAllowlistConfig };

// ─── Tipler ──────────────────────────────────────────────────────────────────

/** Backup schedule konfigürasyonu — bir DB'nin otomatik yedekleme ayarları. */
export interface BackupScheduleConfig {
  /** Cron expression — örn: "0 2 * * *" */
  cron: string;
  enabled: boolean;
  retain: number;
}

/** Admin giriş bilgileri — DB'den yüklenir. */
export interface AdminCredentials {
  email: string;
  passwordHash: string;
}

// ─── Servis ───────────────────────────────────────────────────────────────────

export class SettingsService {
  /** Provision tamamlandıktan sonra resolve eden promise. */
  private ready: Promise<void> | null = null;

  constructor(private readonly sql: Sql) {}

  // ── Provision ─────────────────────────────────────────────────────────────

  private ensureReady(): Promise<void> {
    if (!this.ready) {
      this.ready = this.provision().catch((err) => {
        // Provision başarısız olursa bir sonraki çağrıda retry
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

  /** Sunucu başlangıcında otomatik açılacak DB listesini döner. */
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

  /** Otomatik başlatılacak DB listesini günceller. */
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

  /** Tüm backup schedule konfigürasyonlarını döner: { dbName → config } */
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

  /** Belirli bir DB'nin backup schedule'ını döner. Yoksa null. */
  async getBackupSchedule(dbName: string): Promise<BackupScheduleConfig | null> {
    const schedules = await this.getAllBackupSchedules();
    return schedules[dbName] ?? null;
  }

  /** Bir DB'nin backup schedule'ını kaydeder veya günceller. */
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

  /** Bir DB'nin backup schedule'ını siler. */
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
   * Bir DB'nin IP erişim listesini okur.
   * Ayar yoksa varsayılan (everyone, boş liste) döner.
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

  /** Bir DB'nin IP erişim listesini kaydeder. */
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

  /** Bir DB'nin IP erişim listesini siler (everyone moduna döner). */
  async deleteIpAllowlist(dbName: string): Promise<void> {
    await this.ensureReady();
    await this.sql`
      DELETE FROM _postgrify_settings WHERE key = ${"ip_allowlist:" + dbName}
    `;
  }

  // ── Admin setup flag ───────────────────────────────────────────────────────

  /**
   * DB'de admin kurulumunun tamamlandığı kaydını kontrol eder.
   * Tablo yoksa veya bağlantı hatası varsa false döner (hata fırlatmaz).
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
   * DB'ye admin kurulumunun tamamlandığını yazar.
   * POST /setup başarısında çağrılır.
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
   * Admin kimlik bilgilerini DB'ye kalıcı olarak yazar.
   *
   * Docker container'da `.env`'ye yazma başarısız olduğunda bu method devreye
   * girer. Bilgiler PostgreSQL volume'unda kalıcı olarak saklanır; container
   * restart'larında kaybolmaz.
   *
   * Key'ler parametrik geçirilir — mock'larda args[1]=key, args[2]=value
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
   * Admin kimlik bilgilerini DB'den yükler.
   * Email veya hash eksikse null döner.
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

  // ── Database silme yardımcısı ──────────────────────────────────────────────

  /**
   * Bir DB silindiğinde ilgili tüm ayarları temizler.
   * (backup_schedule + ip_allowlist)
   */
  async deleteDatabase(dbName: string): Promise<void> {
    await this.deleteBackupSchedule(dbName);
    await this.deleteIpAllowlist(dbName);
  }
}