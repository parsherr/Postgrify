/**
 * Pool Manager — manages independent connection pools for each PostgreSQL database.
 *
 * - Lazy initialization: pool is created on the first `getPool(dbName)` call
 * - Idle timeout: unused pools are automatically closed
 * - `closeAll()`: closes all pools for graceful shutdown
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
  startedAt: number; // time the pool was opened (ms)
}

export class PoolManager {
  private pools = new Map<string, PoolEntry>();
  private idleTimer: NodeJS.Timeout | null = null;

  constructor(private readonly cfg: PoolManagerConfig) {
    // Check idle pools every minute
    this.idleTimer = setInterval(() => this.evictIdlePools(), 60_000);
  }

  /**
   * Returns the pool for the given DB name, creating it if it does not exist.
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
      keep_alive: 10,          // TCP keepalive: prevents the host PG from dropping idle connections
      prepare: false,           // PgBouncer compatibility + easier reconnect
      onnotice: () => {}, // suppress notice noise
    });

    const now = Date.now();
    this.pools.set(dbName, { sql, lastUsed: now, startedAt: now });
    return sql;
  }

  /**
   * Manually closes the pool for a specific DB.
   */
  async releasePool(dbName: string): Promise<void> {
    const entry = this.pools.get(dbName);
    if (entry) {
      await entry.sql.end();
      this.pools.delete(dbName);
    }
  }

  /**
   * Closes all pools. Called during graceful shutdown.
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
   * Gracefully closes pools that have exceeded the IDLE_TIMEOUT.
   *
   * Graceful drain: `end({ timeout: 30 })` waits up to 30 seconds for active queries
   * to finish. If the timeout is exceeded the connection is force-closed; in-flight
   * queries may be lost, but the goal is to minimize loss. Setting the timeout to
   * 30 seconds instead of 5 ensures short transactions complete.
   *
   * Note: postgres.js does not allow programmatically querying the number of active
   * transactions per connection. The recommended pattern for safe eviction:
   *   - Keep idleTimeout high (default 10 minutes)
   *   - closeAll() already drains all connections during graceful shutdown
   */
  private async evictIdlePools(): Promise<void> {
    const now = Date.now();
    for (const [dbName, entry] of this.pools.entries()) {
      if (now - entry.lastUsed > this.cfg.idleTimeout) {
        // Remove from map first — new incoming requests will get a new pool, no race condition
        this.pools.delete(dbName);
        // Graceful drain: wait up to 30 seconds for active queries to finish
        entry.sql.end({ timeout: 30 }).catch(() => {
          // Force-close may silently fail — this is expected
        });
      }
    }
  }

  /** Returns the number of active pools (for monitoring). */
  get activePoolCount(): number {
    return this.pools.size;
  }

  /** Returns the names of active pools. */
  get activePoolNames(): string[] {
    return Array.from(this.pools.keys());
  }

  /** Returns the pool start time (ms) for the given DB. Returns null if not found. */
  getPoolStartedAt(dbName: string): number | null {
    return this.pools.get(dbName)?.startedAt ?? null;
  }
}