/**
 * JWT Service — token üretimi ve doğrulaması.
 * jose kütüphanesi kullanılır (Web Crypto API tabanlı, zero-dep).
 *
 * İki token türü farklı metotlarla doğrulanır:
 *   - verifyAdminOrDb : admin token + scoped DB token (iss: "postgrify")
 *   - verifyDbUser    : per-DB kullanıcı token (iss: "postgrify/db-auth" zorunlu)
 */

import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import type { JwtPayload, DbUserJwtPayload, TokenScope } from "../types/auth.js";

const ADMIN_ISSUER = "postgrify";
const DB_USER_ISSUER = "postgrify/db-auth";

export class JwtService {
  private readonly secret: Uint8Array;

  constructor(secret: string) {
    this.secret = new TextEncoder().encode(secret);
  }

  /**
   * DB bazlı token üretir.
   */
  async signDbToken(
    database: string,
    scope: TokenScope[],
    expiresIn: string = "24h"
  ): Promise<string> {
    return new SignJWT({ sub: database, scope, role: "db" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime(expiresIn)
      .sign(this.secret);
  }

  /**
   * Admin token üretir. Tüm DB'lere ve tüm scope'lara tam erişim.
   * email verilirse payload'a eklenir (GUI login akışı).
   */
  async signAdminToken(expiresIn: string = "24h", email?: string): Promise<string> {
    const payload: Record<string, unknown> = { role: "admin" };
    if (email) payload.email = email;

    return new SignJWT(payload)
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setIssuer(ADMIN_ISSUER)
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
   * Geçersiz/süresi dolmuşsa null döner.
   */
  async verifyAdminOrDb(token: string): Promise<JwtPayload | null> {
    try {
      const { payload } = await jwtVerify(token, this.secret);
      // per-DB user token'ının bu path'e girmesini engelle
      if ((payload as JWTPayload).iss === DB_USER_ISSUER) return null;
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