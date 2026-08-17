/**
 * Session Service — admin refresh token management in Redis.
 *
 * - On every login, an opaque token is generated with crypto.randomBytes(32)
 * - Redis key: session:<token>  →  JSON { email, createdAt }
 * - TTL: REFRESH_TOKEN_EXPIRY is converted to seconds
 * - When Redis is unavailable, all methods are no-ops (no refresh token support)
 *
 * Kept separate from CacheService: different namespace (session: vs postgrify:)
 * and different client lifecycle requirements.
 */

import { randomBytes } from "node:crypto";
import { createClient, type RedisClientType } from "redis";

export interface SessionData {
  email: string;
  createdAt: number;
}

const SESSION_PREFIX = "session:";

export class SessionService {
  private client: RedisClientType | null = null;
  private ttlSeconds: number;

  constructor(redisUrl: string | undefined, refreshTokenExpiry: string) {
    this.ttlSeconds = parseDuration(refreshTokenExpiry);

    if (redisUrl) {
      this.client = createClient({ url: redisUrl }) as RedisClientType;
    }
  }

  async connect(): Promise<void> {
    if (!this.client) return;
    await this.client.connect();
  }

  async disconnect(): Promise<void> {
    if (!this.client) return;
    await this.client.quit();
  }

  /**
   * Generates a new refresh token, stores it in Redis, and returns it.
   * Returns null when Redis is unavailable — the caller operates in silent mode.
   */
  async create(email: string): Promise<string | null> {
    if (!this.client) return null;

    const token = randomBytes(32).toString("hex");
    const data: SessionData = { email, createdAt: Date.now() };

    await this.client.set(
      `${SESSION_PREFIX}${token}`,
      JSON.stringify(data),
      { EX: this.ttlSeconds }
    );

    return token;
  }

  /**
   * Returns SessionData if the refresh token is valid, otherwise null.
   */
  async get(token: string): Promise<SessionData | null> {
    if (!this.client) return null;

    const raw = await this.client.get(`${SESSION_PREFIX}${token}`);
    if (!raw) return null;

    try {
      return JSON.parse(raw) as SessionData;
    } catch {
      return null;
    }
  }

  /**
   * Deletes the refresh token from Redis (logout / revoke).
   */
  async revoke(token: string): Promise<void> {
    if (!this.client) return;
    await this.client.del(`${SESSION_PREFIX}${token}`);
  }

  /**
   * Token rotation: delete the old token, generate a new one, and store it.
   * Security: the old token is invalidated after every refresh.
   * Returns null when Redis is unavailable.
   */
  async rotate(oldToken: string, email: string): Promise<string | null> {
    if (!this.client) return null;

    // Delete the old token first — not atomic, but safe because
    // Redis is single-threaded, so sequential DEL + SET is safe.
    await this.client.del(`${SESSION_PREFIX}${oldToken}`);

    const newToken = randomBytes(32).toString("hex");
    const data: SessionData = { email, createdAt: Date.now() };

    await this.client.set(
      `${SESSION_PREFIX}${newToken}`,
      JSON.stringify(data),
      { EX: this.ttlSeconds }
    );

    return newToken;
  }

  /**
   * Returns all active sessions belonging to a specific email.
   * Uses Redis SCAN — use with caution in production on large session pools.
   */
  async listByEmail(email: string): Promise<Array<{ token: string; data: SessionData; ttl: number }>> {
    if (!this.client) return [];

    const results: Array<{ token: string; data: SessionData; ttl: number }> = [];
    const pattern = `${SESSION_PREFIX}*`;

    for await (const key of this.client.scanIterator({ MATCH: pattern, COUNT: 100 })) {
      const [raw, ttl] = await Promise.all([
        this.client.get(key),
        this.client.ttl(key),
      ]);
      if (!raw) continue;
      try {
        const data = JSON.parse(raw) as SessionData;
        if (data.email === email) {
          results.push({ token: key.replace(SESSION_PREFIX, ""), data, ttl });
        }
      } catch {
        // Corrupt record — skip
      }
    }

    return results;
  }

  /**
   * Lists all active sessions (for the admin panel).
   */
  async listAll(): Promise<Array<{ token: string; data: SessionData; ttl: number }>> {
    if (!this.client) return [];

    const results: Array<{ token: string; data: SessionData; ttl: number }> = [];
    const pattern = `${SESSION_PREFIX}*`;

    for await (const key of this.client.scanIterator({ MATCH: pattern, COUNT: 100 })) {
      const [raw, ttl] = await Promise.all([
        this.client.get(key),
        this.client.ttl(key),
      ]);
      if (!raw) continue;
      try {
        const data = JSON.parse(raw) as SessionData;
        results.push({ token: key.replace(SESSION_PREFIX, ""), data, ttl });
      } catch {
        // Corrupt record — skip
      }
    }

    return results;
  }

  /**
   * Revokes all sessions belonging to a specific email.
   */
  async revokeAllByEmail(email: string): Promise<number> {
    if (!this.client) return 0;

    const sessions = await this.listByEmail(email);
    if (sessions.length === 0) return 0;

    await this.client.del(sessions.map((s) => `${SESSION_PREFIX}${s.token}`));
    return sessions.length;
  }

  /** Is Redis connected? */
  get isAvailable(): boolean {
    return this.client !== null;
  }
}

/**
 * Converts duration strings like "7d", "15m", "24h" to seconds.
 * Invalid format → 604800 (7 days) default.
 */
function parseDuration(value: string): number {
  const match = value.match(/^(\d+)(s|m|h|d)$/);
  if (!match) return 604_800;
  const [, num, unit] = match;
  const multipliers: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
  return Number(num) * multipliers[unit];
}