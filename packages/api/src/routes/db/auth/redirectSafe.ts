/**
 * Shared open-redirect guard (same origin as APP_URL only).
 * Used by OAuth callback and C-11 verify redirect_to.
 */

import { config } from "../../../config/env.js";

export function safeAppRedirect(rawRedirect: string | undefined | null): string {
  const fallback = `${config.APP_URL}/auth/callback`;
  if (!rawRedirect) return fallback;
  try {
    const appOrigin = new URL(config.APP_URL).origin;
    const candidate = new URL(rawRedirect);
    return candidate.origin === appOrigin ? rawRedirect : fallback;
  } catch {
    return fallback;
  }
}

/** Build GoTrue-style hash fragment for browser redirect. */
export function sessionFragment(opts: {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  expiresAt: number;
  type: string;
}): string {
  const params = new URLSearchParams({
    access_token: opts.accessToken,
    refresh_token: opts.refreshToken,
    token_type: "bearer",
    expires_in: String(opts.expiresIn),
    expires_at: String(opts.expiresAt),
    type: opts.type,
  });
  return params.toString();
}
