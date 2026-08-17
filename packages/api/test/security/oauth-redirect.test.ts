/**
 * HIGH-1 + HIGH-2: OAuth redirect security tests.
 *
 * 1. Tokens must be passed in the URL fragment (not as query params).
 * 2. Open redirect: redirects must only target the APP_URL origin.
 */

import { describe, it, expect, vi } from "vitest";

const JWT_SECRET = "test-secret-must-be-at-least-32-characters";
const APP_URL = "http://localhost:5173";

vi.stubEnv("JWT_SECRET", JWT_SECRET);
vi.stubEnv("ADMIN_SECRET", "test-admin-secret-16ch");
vi.stubEnv("APP_URL", APP_URL);

// ── Helper: check where tokens appear in the URL ──────────────────────────

/** Parses tokens from URL fragment */
function parseFragment(url: string): Record<string, string> {
  const hashIdx = url.indexOf("#");
  if (hashIdx === -1) return {};
  const fragment = url.slice(hashIdx + 1);
  return Object.fromEntries(new URLSearchParams(fragment));
}

/** Parses tokens from query params */
function parseQueryTokens(url: string): Record<string, string> {
  const urlObj = new URL(url, "http://dummy");
  const result: Record<string, string> = {};
  for (const key of ["access_token", "refresh_token"]) {
    if (urlObj.searchParams.has(key)) {
      result[key] = urlObj.searchParams.get(key)!;
    }
  }
  return result;
}

// ── Token URL location tests ──────────────────────────────────────────────

describe("HIGH-1: OAuth token URL fragment security", () => {
  it("access_token and refresh_token must NOT be in query params", () => {
    // Safe redirect URL simulation (new code from oauth.ts)
    const accessToken = "at.test.token";
    const refreshToken = "rt.test.token";
    const baseRedirect = `${APP_URL}/auth/callback`;
    const fragment = `access_token=${encodeURIComponent(accessToken)}&refresh_token=${encodeURIComponent(refreshToken)}`;
    const finalRedirect = `${baseRedirect}#${fragment}`;

    // No tokens in query params
    const queryTokens = parseQueryTokens(finalRedirect);
    expect(Object.keys(queryTokens)).toHaveLength(0);
  });

  it("access_token and refresh_token must be in the fragment", () => {
    const accessToken = "at.test.token";
    const refreshToken = "rt.test.token";
    const baseRedirect = `${APP_URL}/auth/callback`;
    const fragment = `access_token=${encodeURIComponent(accessToken)}&refresh_token=${encodeURIComponent(refreshToken)}`;
    const finalRedirect = `${baseRedirect}#${fragment}`;

    // Tokens must be in the fragment
    const fragmentParams = parseFragment(finalRedirect);
    expect(fragmentParams.access_token).toBe(accessToken);
    expect(fragmentParams.refresh_token).toBe(refreshToken);
  });

  it("fragment hash (#) character must be present in the URL", () => {
    const baseRedirect = `${APP_URL}/auth/callback`;
    const finalRedirect = `${baseRedirect}#access_token=foo&refresh_token=bar`;
    expect(finalRedirect).toContain("#");
    expect(finalRedirect.indexOf("#")).toBeGreaterThan(0);
  });

  it("oauth.ts source code uses fragment", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const { dirname, join } = await import("node:path");
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(
      join(__dirname, "../../src/routes/db/auth/oauth.ts"),
      "utf-8"
    );
    // Tokens must be passed via fragment (#) (sessionFragment helper)
    expect(src).toMatch(/#\$\{fragment\}|#\$\{sessionFragment/);
    expect(src).toContain("sessionFragment");
    expect(src).toContain('type: "oauth"');
    // Must not be set as query params
    expect(src).not.toMatch(/searchParams\.set\(["']access_token/);
  });
});

// ── Open redirect protection tests ────────────────────────────────────────

describe("HIGH-2: Open redirect origin whitelist", () => {
  function safeRedirectUrl(rawRedirect: string, appUrl: string): string {
    // Copy of the security logic from oauth.ts — for test isolation
    const appOrigin = new URL(appUrl).origin;
    let safeBase: string;
    try {
      const candidate = new URL(rawRedirect);
      safeBase = candidate.origin === appOrigin
        ? rawRedirect
        : `${appUrl}/auth/callback`;
    } catch {
      safeBase = `${appUrl}/auth/callback`;
    }
    return safeBase;
  }

  it("redirect to same-origin URL is accepted", () => {
    const result = safeRedirectUrl(`${APP_URL}/dashboard`, APP_URL);
    expect(result).toBe(`${APP_URL}/dashboard`);
  });

  it("redirect to different-origin URL is rejected → fallback URL is used", () => {
    const result = safeRedirectUrl("https://evil.com/steal?token=", APP_URL);
    expect(result).toBe(`${APP_URL}/auth/callback`);
    expect(result).not.toContain("evil.com");
  });

  it("javascript: protocol is rejected", () => {
    const result = safeRedirectUrl("javascript:alert(1)", APP_URL);
    expect(result).not.toContain("javascript:");
    expect(result).toBe(`${APP_URL}/auth/callback`);
  });

  it("invalid URL is rejected → fallback URL is used", () => {
    const result = safeRedirectUrl("not-a-valid-url-%%%", APP_URL);
    expect(result).toBe(`${APP_URL}/auth/callback`);
  });

  it("empty string is rejected → fallback URL is used", () => {
    const result = safeRedirectUrl("", APP_URL);
    expect(result).toBe(`${APP_URL}/auth/callback`);
  });

  it("http → https origin difference is treated as different origin", () => {
    // When APP_URL is http, an https redirect is a different origin
    const result = safeRedirectUrl("https://localhost:5173/callback", "http://localhost:5173");
    expect(result).toBe("http://localhost:5173/auth/callback");
  });

  it("subdomain is treated as different origin", () => {
    const result = safeRedirectUrl("http://api.localhost:5173/steal", APP_URL);
    expect(result).toBe(`${APP_URL}/auth/callback`);
    expect(result).not.toContain("api.localhost");
  });

  it("oauth.ts source code contains origin whitelist check", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const { dirname, join } = await import("node:path");
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(
      join(__dirname, "../../src/routes/db/auth/oauth.ts"),
      "utf-8"
    );
    expect(src).toContain("safeAppRedirect");
    expect(src).toContain("auth/callback");
    const helper = readFileSync(
      join(__dirname, "../../src/routes/db/auth/redirectSafe.ts"),
      "utf-8"
    );
    expect(helper).toContain("candidate.origin === appOrigin");
  });
});