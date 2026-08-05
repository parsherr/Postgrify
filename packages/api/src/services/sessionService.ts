/**
 * Session Service — Redis'te admin refresh token yönetimi.
 *
 * - Her login'de crypto.randomBytes(32) ile opaque token üretilir
 * - Redis key: session:<token>  →  JSON { email, createdAt }
 * - TTL: REFRESH_TOKEN_EXPIRY saniyeye çevrilir
 * - Redis yoksa tüm metodlar no-op döner (refresh token desteği yok)
 *
 * CacheService'ten ayrı tutulur: farklı namespace (session: vs postgrify:)
 * ve farklı client lifecycle gerektirir.
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
   * Yeni refresh token üretir, Redis'e kaydeder ve döner.
   * Redis yoksa null döner — caller sessiz modda çalışır.
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
   * Refresh token geçerliyse SessionData döner, geçersizse null.
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
   * Refresh token'ı Redis'ten siler (logout / revoke).
   */
  async revoke(token: string): Promise<void> {
    if (!this.client) return;
    await this.client.del(`${SESSION_PREFIX}${token}`);
  }

  /** Redis bağlı mı? */
  get isAvailable(): boolean {
    return this.client !== null;
  }
}

/**
 * "7d", "15m", "24h" gibi string'leri saniyeye çevirir.
 * Geçersiz format → 604800 (7 gün) default.
 */
function parseDuration(value: string): number {
  const match = value.match(/^(\d+)(s|m|h|d)$/);
  if (!match) return 604_800;
  const [, num, unit] = match;
  const multipliers: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
  return Number(num) * multipliers[unit];
}