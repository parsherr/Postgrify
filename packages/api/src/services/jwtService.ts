/**
 * JWT Service — token üretimi ve doğrulaması.
 * jose kütüphanesi kullanılır (Web Crypto API tabanlı, zero-dep).
 */

import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import type { JwtPayload, TokenScope } from "../types/auth.js";

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
      .setExpirationTime(expiresIn)
      .sign(this.secret);
  }

  /**
   * Token doğrular. Geçersiz/süresi dolmuşsa null döner.
   */
  async verify(token: string): Promise<JwtPayload | null> {
    try {
      const { payload } = await jwtVerify(token, this.secret);
      return payload as JwtPayload;
    } catch {
      return null;
    }
  }
}