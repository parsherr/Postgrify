/**
 * JWT Service — token generation and verification.
 * Uses the jose library (Web Crypto API based, zero-dep).
 *
 * Two token types are verified with different methods:
 *   - verifyAdminOrDb : admin token + scoped DB token (iss: "postgrify")
 *   - verifyDbUser    : per-DB user token (iss: "postgrify/db-auth" required)
 *
 * JTI Blacklist (token revocation):
 *   A JTI (JWT ID)-based blocklist is used for direct admin token revocation.
 *   Each admin token is assigned a unique JTI.
 *   On logout/revoke the JTI is added to the blocklist in Redis (or in-memory).
 *   verifyAdminOrDb rejects blocklisted tokens.
 */

import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import type { JwtPayload, DbUserJwtPayload, TokenScope } from "../types/auth.js";
import crypto from "node:crypto";

const ADMIN_ISSUER = "postgrify";
const DB_ISSUER = "postgrify/db";       // for scoped DB access tokens
const DB_USER_ISSUER = "postgrify/db-auth"; // for per-DB end-user tokens

/**
 * JTI Blacklist — tracks revoked admin JWT tokens.
 *
 * With Redis, JTIs are stored in Redis for the token's remaining TTL.
 * Without Redis, an in-memory Set is used (resets on process restart).
 *
 * Use cases: logout, force-revoke, invalidate all tokens after a password change.
 */
export class JtiBlacklist {
  private readonly memory = new Set<string>();
  private redis: { set(k: string, v: string, opt: { EX: number }): Promise<unknown>; get(k: string): Promise<string | null> } | null = null;

  /** Connect a Redis client (optional). Falls back to in-memory when Redis is unavailable. */
  setRedis(client: { set(k: string, v: string, opt: { EX: number }): Promise<unknown>; get(k: string): Promise<string | null> }): void {
    this.redis = client;
  }

  /** Add a JTI to the blocklist. ttlSeconds: remaining validity of the token. */
  async add(jti: string, ttlSeconds: number): Promise<void> {
    if (this.redis) {
      await this.redis.set(`jti:${jti}`, "1", { EX: ttlSeconds });
    } else {
      this.memory.add(jti);
      // No automatic TTL in-memory; use a timeout to clean up for long-running
      // processes to prevent memory leaks.
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

/** Global singleton — connected to Redis at server startup. */
export const jtiBlacklist = new JtiBlacklist();

export class JwtService {
  /**
   * Secret source: a fixed string or a getter read at runtime.
   * Using a getter captures post-setup config updates —
   * even instances created with a placeholder secret during route
   * registration will read the current value on subsequent requests.
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
   * Produces a DB-scoped access token.
   * Distinguished from admin and end-user tokens by iss: "postgrify/db".
   * Defense in depth: missing issuer prevents "unknown origin" token issues.
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
   * Produces an admin token. Full access to all DBs and all scopes.
   * If email is provided, it is added to the payload (GUI login flow).
   * JTI (JWT ID) is added — required for token revocation.
   */
  async signAdminToken(expiresIn: string = "24h", email?: string): Promise<string> {
    const payload: Record<string, unknown> = { role: "admin" };
    if (email) payload.email = email;

    return new SignJWT(payload)
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setIssuer(ADMIN_ISSUER)
      .setJti(crypto.randomUUID())   // unique ID for revocation
      .setExpirationTime(expiresIn)
      .sign(this.secret);
  }

  /**
   * Produces a per-database user token.
   * Unambiguously distinguished from admin tokens by iss: "postgrify/db-auth".
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
   * Verifies an admin token or a scoped DB token.
   * Rejects per-DB user tokens with iss: "postgrify/db-auth".
   * Rejects revoked tokens (JTI blocklist).
   * Returns null if invalid or expired.
   */
  async verifyAdminOrDb(token: string): Promise<JwtPayload | null> {
    try {
      const { payload } = await jwtVerify(token, this.secret);
      const iss = (payload as JWTPayload).iss;
      // Prevent per-DB end-user tokens from entering this path
      if (iss === DB_USER_ISSUER) return null;
      // Valid issuers: ADMIN_ISSUER, DB_ISSUER, or iss=undefined for legacy tokens
      // (backward compat: older DB tokens do not include iss)
      if (iss !== undefined && iss !== ADMIN_ISSUER && iss !== DB_ISSUER) return null;

      // JTI blocklist check — reject revoked tokens
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
   * Verifies a per-database user token.
   * iss: "postgrify/db-auth" zorunludur — admin token'lar reddedilir.
   * Returns null if invalid or expired.
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
   * @deprecated Use verifyAdminOrDb().
   * Kept for backward compatibility — prevents existing call sites from breaking.
   */
  async verify(token: string): Promise<JwtPayload | null> {
    return this.verifyAdminOrDb(token);
  }
}