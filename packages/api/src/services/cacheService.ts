/**
 * Cache Service — Redis veya in-memory LRU cache.
 * Dışarıya aynı arayüzü sunar; implementasyon otomatik seçilir.
 *
 * TTL sabit değerleri (saniye):
 *   ROW_QUERY   = 30
 *   SCHEMA      = 300  (5 dk)
 *   TABLE_LIST  = 120  (2 dk)
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
   * Pattern ile eşleşen tüm key'leri siler (invalidasyon için).
   * In-memory modda prefix eşleşmesi kullanılır.
   */
  async invalidatePattern(pattern: string): Promise<void> {
    if (this.redis) {
      // KEYS yerine SCAN kullan — production Redis'te KEYS blocking'dir
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

  /** Rate limit plugin'i için Redis client'ını doğrudan expose eder. */
  get redisClient(): RedisClientType | null {
    return this.redis;
  }

  buildKey(...parts: string[]): string {
    return `postgrify:${parts.join(":")}`;
  }
}