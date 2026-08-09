/**
 * Pool Manager — Her PostgreSQL veritabanı için bağımsız connection pool yönetir.
 *
 * - Lazy initialization: pool, ilk `getPool(dbName)` çağrısında oluşturulur
 * - Idle timeout: kullanılmayan pool'lar otomatik kapatılır
 * - `closeAll()`: graceful shutdown için tüm pool'ları kapatır
 */

import postgres from "postgres";

interface PoolManagerConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  ssl: boolean;
  maxPoolSize: number;
  idleTimeout: number;
  maxLifetime: number;
}

interface PoolEntry {
  sql: postgres.Sql;
  lastUsed: number;
  startedAt: number; // pool açılma zamanı (ms)
}

export class PoolManager {
  private pools = new Map<string, PoolEntry>();
  private idleTimer: NodeJS.Timeout | null = null;

  constructor(private readonly cfg: PoolManagerConfig) {
    // Her dakika idle pool'ları kontrol et
    this.idleTimer = setInterval(() => this.evictIdlePools(), 60_000);
  }

  /**
   * Verilen DB adı için pool döner. Yoksa oluşturur.
   */
  getPool(dbName: string): postgres.Sql {
    const entry = this.pools.get(dbName);
    if (entry) {
      entry.lastUsed = Date.now();
      return entry.sql;
    }

    const sql = postgres({
      host: this.cfg.host,
      port: this.cfg.port,
      user: this.cfg.user,
      password: this.cfg.password,
      database: dbName,
      ssl: this.cfg.ssl ? "require" : false,
      max: this.cfg.maxPoolSize,
      idle_timeout: Math.floor(this.cfg.idleTimeout / 1000),
      max_lifetime: Math.floor(this.cfg.maxLifetime / 1000),
      connect_timeout: 10,
      keep_alive: 10,          // TCP keepalive: host PG bağlantıyı idle'da kesmez
      prepare: false,           // PgBouncer uyumluluğu + reconnect kolaylığı
      onnotice: () => {}, // gürültüyü bastır
    });

    const now = Date.now();
    this.pools.set(dbName, { sql, lastUsed: now, startedAt: now });
    return sql;
  }

  /**
   * Belirli bir DB için pool'u manuel kapatır.
   */
  async releasePool(dbName: string): Promise<void> {
    const entry = this.pools.get(dbName);
    if (entry) {
      await entry.sql.end();
      this.pools.delete(dbName);
    }
  }

  /**
   * Tüm pool'ları kapatır. Graceful shutdown'da çağrılır.
   */
  async closeAll(): Promise<void> {
    if (this.idleTimer) {
      clearInterval(this.idleTimer);
    }
    await Promise.all(
      Array.from(this.pools.values()).map((e) => e.sql.end())
    );
    this.pools.clear();
  }

  /**
   * IDLE_TIMEOUT süresini aşan pool'ları graceful olarak kapatır.
   *
   * Graceful drain: `end({ timeout: 30 })` ile aktif sorguların 30 saniyeye kadar
   * bitmesini bekler. Bu süre aşılırsa bağlantı zorla kapatılır; in-flight sorgu
   * kaybolabilir ama minimum kaybı hedefler. Timeout'u 5 yerine 30 saniye olarak
   * ayarlamak kısa transaction'ların tamamlanmasını sağlar.
   *
   * Not: postgres.js bağlantı başına aktif transaction sayısını programatik
   * olarak sorgulamaya izin vermiyor. Güvenli eviction için önerilen pattern:
   *   - İdleTimeout'u yüksek tutun (varsayılan 10 dakika)
   *   - closeAll() graceful shutdown'da zaten tüm bağlantıları drainer
   */
  private async evictIdlePools(): Promise<void> {
    const now = Date.now();
    for (const [dbName, entry] of this.pools.entries()) {
      if (now - entry.lastUsed > this.cfg.idleTimeout) {
        // Önce map'ten çıkar — yeni gelen istekler yeni pool alır, race condition olmaz
        this.pools.delete(dbName);
        // Graceful drain: 30 saniye timeout ile aktif sorguların bitmesini bekle
        entry.sql.end({ timeout: 30 }).catch(() => {
          // Zorla kapatma sessizce başarısız olabilir — bu beklenen durum
        });
      }
    }
  }

  /** Kaç aktif pool olduğunu döner (monitoring için). */
  get activePoolCount(): number {
    return this.pools.size;
  }

  /** Aktif pool isimlerini döner. */
  get activePoolNames(): string[] {
    return Array.from(this.pools.keys());
  }

  /** Belirtilen DB'nin pool başlangıç zamanını döner (ms). Yoksa null. */
  getPoolStartedAt(dbName: string): number | null {
    return this.pools.get(dbName)?.startedAt ?? null;
  }
}