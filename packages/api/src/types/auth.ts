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

export interface JwtPayload extends JWTPayload {
  role: "admin" | "db";
  sub?: string;          // DB adı (DB token için)
  scope?: TokenScope[];  // İzin verilen scope'lar (DB token için)
  email?: string;        // Admin kullanıcı e-postası (admin token için)
}