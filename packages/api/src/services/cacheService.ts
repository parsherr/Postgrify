/**
 * Cache Service — Redis or in-memory LRU cache.
 * Exposes the same interface externally; implementation is selected automatically.
 *
 * TTL constants (seconds):
 *   ROW_QUERY   = 30
 *   SCHEMA      = 300  (5 min)
 *   TABLE_LIST  = 120  (2 min)
 *   DB_SIZE     = 60
 */

import { createClient, type RedisClientType } from "redis";
import { LRUCache } from "lru-cache";

export const TTL = {
  ROW_QUERY: 30,
  SCHEMA: 300,
  TABLE_LIST: 120,
  DB_SIZE: 60,
} as const;

export class CacheService {
  private redis: RedisClientType | null = null;
  private lru: LRUCache<string, string> | null = null;

  constructor(private readonly redisUrl?: string) {}

  async connect(): Promise<void> {
    if (this.redisUrl) {
      this.redis = createClient({ url: this.redisUrl }) as RedisClientType;
      this.redis.on("error", (err) =>
        console.error("Redis error:", err.message)
      );
      await this.redis.connect();
    } else {
      this.lru = new LRUCache<string, string>({
        max: 1000,
        ttl: TTL.ROW_QUERY * 1000,
      });
    }
  }

  async get(key: string): Promise<string | null> {
    if (this.redis) return this.redis.get(key);
    return this.lru?.get(key) ?? null;
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    if (this.redis) {
      await this.redis.set(key, value, { EX: ttlSeconds });
    } else {
      this.lru?.set(key, value, { ttl: ttlSeconds * 1000 });
    }
  }

  async del(key: string): Promise<void> {
    if (this.redis) await this.redis.del(key);
    else this.lru?.delete(key);
  }

  /**
   * Deletes all keys matching a pattern (for cache invalidation).
   * In-memory mode uses prefix matching.
   */
  async invalidatePattern(pattern: string): Promise<void> {
    if (this.redis) {
      // Use SCAN instead of KEYS — KEYS is blocking in production Redis
      const keysToDelete: string[] = [];
      for await (const key of this.redis.scanIterator({ MATCH: pattern, COUNT: 100 })) {
        keysToDelete.push(key);
      }
      if (keysToDelete.length > 0) await this.redis.del(keysToDelete);
    } else if (this.lru) {
      const prefix = pattern.replace(/\*/g, "");
      for (const key of this.lru.keys()) {
        if (key.startsWith(prefix)) this.lru.delete(key);
      }
    }
  }

  async disconnect(): Promise<void> {
    if (this.redis) await this.redis.disconnect();
  }

  /** Directly exposes the Redis client for the rate-limit plugin. */
  get redisClient(): RedisClientType | null {
    return this.redis;
  }

  /**
   * Builds a cache key. Strips `:` and `*` characters from each part.
   *
   * Security: `buildKey("db:evil", "table")` → `postgrify:dbevil:table`
   * Prevents cache poisoning/traversal attacks.
   * e.g. a `*` wildcard cannot be injected into a Redis SCAN pattern.
   */
  buildKey(...parts: string[]): string {
    const safeParts = parts.map((p) => p.replace(/[:\s*]/g, ""));
    return `postgrify:${safeParts.join(":")}`;
  }
}