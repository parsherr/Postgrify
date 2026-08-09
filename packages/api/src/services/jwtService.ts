/**
 * JWT Service — token üretimi ve doğrulaması.
 * jose kütüphanesi kullanılır (Web Crypto API tabanlı, zero-dep).
 *
 * İki token türü farklı metotlarla doğrulanır:
 *   - verifyAdminOrDb : admin token + scoped DB token (iss: "postgrify")
 *   - verifyDbUser    : per-DB kullanıcı token (iss: "postgrify/db-auth" zorunlu)
 *
 * JTI Blacklist (token revocation):
 *   Admin token'ların doğrudan revoke edilmesi için JTI (JWT ID) bazlı
 *   kara liste kullanılır. Her admin token'a benzersiz JTI atanır.
 *   Logout/revoke sırasında JTI Redis'te (veya in-memory) kara listeye eklenir.
 *   verifyAdminOrDb kara listeye düşmüş token'ları reddeder.
 */

import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import type { JwtPayload, DbUserJwtPayload, TokenScope } from "../types/auth.js";
import crypto from "node:crypto";

const ADMIN_ISSUER = "postgrify";
const DB_ISSUER = "postgrify/db";       // scoped DB access token'ları için
const DB_USER_ISSUER = "postgrify/db-auth"; // per-DB end-user token'ları için

/**
 * JTI Blacklist — revoke edilmiş admin JWT token'larını izler.
 *
 * Redis varsa JTI'ler token'ın TTL'i kadar Redis'te saklanır.
 * Redis yoksa in-memory Set kullanılır (process restart'ta sıfırlanır).
 *
 * Kullanım: logout, force-revoke, şifre değişikliği sonrası tüm token'ları geçersiz kıl.
 */
export class JtiBlacklist {
  private readonly memory = new Set<string>();
  private redis: { set(k: string, v: string, opt: { EX: number }): Promise<unknown>; get(k: string): Promise<string | null> } | null = null;

  /** Redis client bağla (opsiyonel). Redis yoksa in-memory fallback. */
  setRedis(client: { set(k: string, v: string, opt: { EX: number }): Promise<unknown>; get(k: string): Promise<string | null> }): void {
    this.redis = client;
  }

  /** JTI'yi kara listeye ekle. ttlSeconds: token'ın kalan geçerlilik süresi. */
  async add(jti: string, ttlSeconds: number): Promise<void> {
    if (this.redis) {
      await this.redis.set(`jti:${jti}`, "1", { EX: ttlSeconds });
    } else {
      this.memory.add(jti);
      // In-memory'de otomatik TTL yok; hafıza sızıntısını önlemek için
      // process'in restart olmadan uzun süre çalıştığı durumlarda timeout ile temizle.
      setTimeout(() => this.memory.delete(jti), ttlSeconds * 1000).unref();
    }
  }

  /** JTI kara listede mi? */
  async has(jti: string): Promise<boolean> {
    if (this.redis) {
      return (await this.redis.get(`jti:${jti}`)) !== null;
    }
    return this.memory.has(jti);
  }
}

/** Global singleton — server startup'ta Redis ile bağlanır. */
export const jtiBlacklist = new JtiBlacklist();

export class JwtService {
  /**
   * Secret kaynağı: sabit string veya runtime'da okunacak getter.
   * Getter kullanımı setup-sonrası config güncellemelerini yakalar —
   * route registration sırasında placeholder secret ile yaratılmış
   * instance'lar bile sonraki isteklerde güncel değeri okur.
   */
  private readonly secretSource: string | (() => string);

  constructor(secret: string | (() => string)) {
    this.secretSource = secret;
  }

  private get secret(): Uint8Array {
    const s = typeof this.secretSource === "function" ? this.secretSource() : this.secretSource;
    return new TextEncoder().encode(s);
  }

  /**
   * DB bazlı scoped access token üretir.
   * iss: "postgrify/db" ile admin ve end-user token'lardan ayrılır.
   * Savunma derinliği: issuer eksikliği "unknown origin" token sorununu önler.
   */
  async signDbToken(
    database: string,
    scope: TokenScope[],
    expiresIn: string = "24h"
  ): Promise<string> {
    return new SignJWT({ sub: database, scope, role: "db" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer(DB_ISSUER)
      .setIssuedAt()
      .setExpirationTime(expiresIn)
      .sign(this.secret);
  }

  /**
   * Admin token üretir. Tüm DB'lere ve tüm scope'lara tam erişim.
   * email verilirse payload'a eklenir (GUI login akışı).
   * JTI (JWT ID) eklenir — token revocation için gerekli.
   */
  async signAdminToken(expiresIn: string = "24h", email?: string): Promise<string> {
    const payload: Record<string, unknown> = { role: "admin" };
    if (email) payload.email = email;

    return new SignJWT(payload)
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setIssuer(ADMIN_ISSUER)
      .setJti(crypto.randomUUID())   // revocation için benzersiz ID
      .setExpirationTime(expiresIn)
      .sign(this.secret);
  }

  /**
   * Per-database kullanıcı token üretir.
   * iss: "postgrify/db-auth" ile admin token'lardan kesin ayrılır.
   */
  async signDbUserToken(
    database: string,
    userId: string,
    email: string,
    role: string,
    expiresIn: string = "15m"
  ): Promise<string> {
    return new SignJWT({ db: database, email, role })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(userId)
      .setIssuer(DB_USER_ISSUER)
      .setIssuedAt()
      .setExpirationTime(expiresIn)
      .sign(this.secret);
  }

  /**
   * Admin token veya scoped DB token doğrular.
   * iss: "postgrify/db-auth" olan per-DB user token'larını reddeder.
   * Revoke edilmiş token'ları (JTI blacklist) reddeder.
   * Geçersiz/süresi dolmuşsa null döner.
   */
  async verifyAdminOrDb(token: string): Promise<JwtPayload | null> {
    try {
      const { payload } = await jwtVerify(token, this.secret);
      const iss = (payload as JWTPayload).iss;
      // per-DB end-user token'ını bu path'e girmeyi engelle
      if (iss === DB_USER_ISSUER) return null;
      // Geçerli issuer'lar: ADMIN_ISSUER, DB_ISSUER, veya eski token'lar için iss=undefined
      // (geriye dönük uyumluluk: eski DB token'ları iss içermez)
      if (iss !== undefined && iss !== ADMIN_ISSUER && iss !== DB_ISSUER) return null;

      // JTI blacklist kontrolü — revoke edilmiş token'ları reddet
      const jti = (payload as JWTPayload).jti;
      if (jti && await jtiBlacklist.has(jti)) {
        return null;
      }

      return payload as JwtPayload;
    } catch {
      return null;
    }
  }

  /**
   * Per-database kullanıcı token doğrular.
   * iss: "postgrify/db-auth" zorunludur — admin token'lar reddedilir.
   * Geçersiz/süresi dolmuşsa null döner.
   */
  async verifyDbUser(token: string): Promise<DbUserJwtPayload | null> {
    try {
      const { payload } = await jwtVerify(token, this.secret, {
        issuer: DB_USER_ISSUER,
      });
      return payload as DbUserJwtPayload;
    } catch {
      return null;
    }
  }

  /**
   * @deprecated verifyAdminOrDb() kullanın.
   * Geriye dönük uyumluluk için — mevcut çağrıların patlamasını önler.
   */
  async verify(token: string): Promise<JwtPayload | null> {
    return this.verifyAdminOrDb(token);
  }
}