/**
 * Auth-related type definitions.
 */

import type { JWTPayload } from "jose";

export type TokenScope =
  | "read"
  | "write"
  | "delete"
  | "schema"
  | "query";

/** Admin token or scoped DB token payload. */
export interface JwtPayload extends JWTPayload {
  role: "admin" | "db";
  sub?: string;          // DB name (for DB tokens)
  scope?: TokenScope[];  // Allowed scopes (for DB tokens)
  email?: string;        // Admin user email (for admin tokens)
}

/** Per-database user token payload (iss: "postgrify/db-auth"). */
export interface DbUserJwtPayload extends JWTPayload {
  sub: string;           // userId (UUID)
  db: string;            // hangi managed database
  email: string;
  role: "viewer" | "editor" | "admin";
  iss: "postgrify/db-auth";
}