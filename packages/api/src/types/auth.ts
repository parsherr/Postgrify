/**
 * Auth ile ilgili tip tanımları.
 */

import type { JWTPayload } from "jose";

export type TokenScope =
  | "read"
  | "write"
  | "delete"
  | "schema"
  | "query";

/** Admin token veya scoped DB token payload'ı. */
export interface JwtPayload extends JWTPayload {
  role: "admin" | "db";
  sub?: string;          // DB adı (DB token için)
  scope?: TokenScope[];  // İzin verilen scope'lar (DB token için)
  email?: string;        // Admin kullanıcı e-postası (admin token için)
}

/** Per-database kullanıcı token payload'ı (iss: "postgrify/db-auth"). */
export interface DbUserJwtPayload extends JWTPayload {
  sub: string;           // userId (UUID)
  db: string;            // hangi managed database
  email: string;
  role: "viewer" | "editor" | "admin";
  iss: "postgrify/db-auth";
}