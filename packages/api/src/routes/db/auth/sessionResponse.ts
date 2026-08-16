/**
 * GoTrue-compatible session helpers (C-07+).
 *
 * Response: snake_case (access_token, expires_in seconds, expires_at unix).
 * Request body: accept refresh_token | refreshToken (ADR-008).
 */

import crypto from "node:crypto";
import { config } from "../../../config/env.js";

export function parseDurationMs(expiry: string): number {
  const match = expiry.match(/^(\d+)([smhd])$/);
  if (!match) return 7 * 24 * 60 * 60 * 1000;
  const value = parseInt(match[1], 10);
  const unit = match[2];
  const multipliers: Record<string, number> = {
    s: 1_000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
  };
  return value * (multipliers[unit] ?? 86_400_000);
}

export function expirySeconds(expiry = config.ACCESS_TOKEN_EXPIRY): number {
  return Math.floor(parseDurationMs(expiry) / 1000);
}

export function pickRefreshToken(body: Record<string, unknown>): string | undefined {
  const v = body.refresh_token ?? body.refreshToken;
  return typeof v === "string" ? v : undefined;
}

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export interface AuthUserRow {
  id: string;
  email: string;
  role: string;
  is_active?: boolean;
  email_verified?: boolean;
  created_at?: string | Date | null;
  metadata?: Record<string, unknown> | null;
  provider?: string | null;
  full_name?: string | null;
  avatar_url?: string | null;
}

export interface GoTrueUser {
  id: string;
  aud: "authenticated";
  role: "authenticated";
  email: string;
  email_confirmed_at: string | null;
  created_at: string;
  updated_at: string;
  app_metadata: {
    provider: string;
    providers: string[];
    /** Postgrify scope role (viewer|editor|admin) */
    role: string;
    is_active: boolean;
  };
  user_metadata: Record<string, unknown>;
}

export interface SessionResponse {
  access_token: string;
  token_type: "bearer";
  expires_in: number;
  expires_at: number;
  refresh_token: string | null;
  user: GoTrueUser;
}

function toIso(value: string | Date | null | undefined, fallback: Date): string {
  if (!value) return fallback.toISOString();
  if (value instanceof Date) return value.toISOString();
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? fallback.toISOString() : d.toISOString();
}

export function buildGoTrueUser(user: AuthUserRow, now = new Date()): GoTrueUser {
  const createdAt = toIso(user.created_at, now);
  const provider = (user.provider && String(user.provider)) || "email";
  const emailConfirmedAt = user.email_verified ? createdAt : null;
  const meta =
    user.metadata && typeof user.metadata === "object" && !Array.isArray(user.metadata)
      ? { ...user.metadata }
      : {};
  if (user.full_name && meta.full_name === undefined) meta.full_name = user.full_name;
  if (user.avatar_url && meta.avatar_url === undefined) meta.avatar_url = user.avatar_url;

  return {
    id: String(user.id),
    aud: "authenticated",
    role: "authenticated",
    email: String(user.email),
    email_confirmed_at: emailConfirmedAt,
    created_at: createdAt,
    updated_at: createdAt,
    app_metadata: {
      provider,
      providers: [provider],
      role: String(user.role),
      is_active: user.is_active !== false,
    },
    user_metadata: meta,
  };
}

export function buildSessionResponse(opts: {
  accessToken: string;
  refreshToken: string | null;
  user: AuthUserRow;
  accessExpiry?: string;
  nowMs?: number;
}): SessionResponse {
  const expiresIn = expirySeconds(opts.accessExpiry ?? config.ACCESS_TOKEN_EXPIRY);
  const nowMs = opts.nowMs ?? Date.now();
  return {
    access_token: opts.accessToken,
    token_type: "bearer",
    expires_in: expiresIn,
    expires_at: Math.floor(nowMs / 1000) + expiresIn,
    refresh_token: opts.refreshToken,
    user: buildGoTrueUser(opts.user, new Date(nowMs)),
  };
}
