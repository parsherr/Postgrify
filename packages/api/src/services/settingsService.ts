/**
 * Settings Service — Postgrify'ın kendi meta-verilerini saklar.
 *
 * `postgres` DB'sindeki `_postgrify_settings` tablosunu kullanır.
 * Tablo yoksa otomatik oluşturulur.
 *
 * Şu an sakladığı tek şey: hangi DB'lerin `auto_start=true` olduğu.
 */

import postgres from "postgres";

export class SettingsService {
  private ready: Promise<void>;

  constructor(private readonly sql: postgres.Sql) {
    this.ready = this.provision();
  }

  private async provision(): Promise<void> {
    await this.sql`
      CREATE TABLE IF NOT EXISTS _postgrify_settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `;
  }

  private async ensureReady(): Promise<void> {
    await this.ready;
  }

  /** Belirli bir DB için auto_start değerini döner. */
  async getAutoStart(dbName: string): Promise<boolean> {
    await this.ensureReady();
    const rows = await this.sql`
      SELECT value FROM _postgrify_settings WHERE key = ${"auto_start:" + dbName}
    `;
    return rows[0]?.value === "true";
  }

  /** auto_start=true olan tüm DB adlarını döner. */
  async getAutoStartDatabases(): Promise<string[]> {
    await this.ensureReady();
    const rows = await this.sql`
      SELECT key FROM _postgrify_settings
      WHERE key LIKE 'auto_start:%' AND value = 'true'
    `;
    return rows.map((r) => (r.key as string).replace("auto_start:", ""));
  }

  /** Bir DB için auto_start değerini günceller. */
  async setAutoStart(dbName: string, enabled: boolean): Promise<void> {
    await this.ensureReady();
    const key = "auto_start:" + dbName;
    const value = enabled ? "true" : "false";
    await this.sql`
      INSERT INTO _postgrify_settings (key, value)
      VALUES (${key}, ${value})
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
    `;
  }

  /** Bir DB silindiğinde ilgili ayarları temizler. */
  async deleteDatabase(dbName: string): Promise<void> {
    await this.ensureReady();
    await this.sql`
      DELETE FROM _postgrify_settings WHERE key LIKE ${"auto_start:" + dbName}
    `;
  }
}