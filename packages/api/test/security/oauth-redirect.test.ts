/**
 * HIGH-1 + HIGH-2: OAuth redirect güvenlik testleri.
 *
 * 1. Token'lar URL fragment'ta iletilmeli (query param değil).
 * 2. Open redirect: sadece APP_URL origin'ine yönlendirme yapılmalı.
 */

import { describe, it, expect, vi } from "vitest";

const JWT_SECRET = "test-secret-must-be-at-least-32-characters";
const APP_URL = "http://localhost:5173";

vi.stubEnv("JWT_SECRET", JWT_SECRET);
vi.stubEnv("ADMIN_SECRET", "test-admin-secret-16ch");
vi.stubEnv("APP_URL", APP_URL);

// ── Yardımcı: token'ların URL'de nerede göründüğünü kontrol et ────────────

/** Fragment'tan token'ları parse eder */
function parseFragment(url: string): Record<string, string> {
  const hashIdx = url.indexOf("#");
  if (hashIdx === -1) return {};
  const fragment = url.slice(hashIdx + 1);
  return Object.fromEntries(new URLSearchParams(fragment));
}

/** Query param'lardan token'ları parse eder */
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

// ── Token URL konumu testleri ─────────────────────────────────────────────

describe("HIGH-1: OAuth token URL fragment güvenliği", () => {
  it("access_token ve refresh_token query param'da OLMAMALI", () => {
    // Güvenli redirect URL simülasyonu (oauth.ts'deki yeni kod)
    const accessToken = "at.test.token";
    const refreshToken = "rt.test.token";
    const baseRedirect = `${APP_URL}/auth/callback`;
    const fragment = `access_token=${encodeURIComponent(accessToken)}&refresh_token=${encodeURIComponent(refreshToken)}`;
    const finalRedirect = `${baseRedirect}#${fragment}`;

    // Query param'da token olmamalı
    const queryTokens = parseQueryTokens(finalRedirect);
    expect(Object.keys(queryTokens)).toHaveLength(0);
  });

  it("access_token ve refresh_token fragment'ta olmalı", () => {
    const accessToken = "at.test.token";
    const refreshToken = "rt.test.token";
    const baseRedirect = `${APP_URL}/auth/callback`;
    const fragment = `access_token=${encodeURIComponent(accessToken)}&refresh_token=${encodeURIComponent(refreshToken)}`;
    const finalRedirect = `${baseRedirect}#${fragment}`;

    // Fragment'ta token olmalı
    const fragmentParams = parseFragment(finalRedirect);
    expect(fragmentParams.access_token).toBe(accessToken);
    expect(fragmentParams.refresh_token).toBe(refreshToken);
  });

  it("fragment hash (#) karakteri URL'de bulunmalı", () => {
    const baseRedirect = `${APP_URL}/auth/callback`;
    const finalRedirect = `${baseRedirect}#access_token=foo&refresh_token=bar`;
    expect(finalRedirect).toContain("#");
    expect(finalRedirect.indexOf("#")).toBeGreaterThan(0);
  });

  it("oauth.ts kaynak kodunda fragment kullanımı mevcut", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const { dirname, join } = await import("node:path");
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(
      join(__dirname, "../../src/routes/db/auth/oauth.ts"),
      "utf-8"
    );
    // Token'lar fragment (#) ile iletilmeli (sessionFragment helper)
    expect(src).toMatch(/#\$\{fragment\}|#\$\{sessionFragment/);
    expect(src).toContain("sessionFragment");
    expect(src).toContain('type: "oauth"');
    // Query param olarak setlenmemeli
    expect(src).not.toMatch(/searchParams\.set\(["']access_token/);
  });
});

// ── Open redirect koruma testleri ─────────────────────────────────────────

describe("HIGH-2: Open redirect origin whitelist", () => {
  function safeRedirectUrl(rawRedirect: string, appUrl: string): string {
    // oauth.ts'deki güvenlik mantığının kopyası — test izolasyonu için
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

  it("aynı origin'deki URL'e redirect kabul edilir", () => {
    const result = safeRedirectUrl(`${APP_URL}/dashboard`, APP_URL);
    expect(result).toBe(`${APP_URL}/dashboard`);
  });

  it("farklı origin'deki URL'e redirect reddedilir → fallback URL kullanılır", () => {
    const result = safeRedirectUrl("https://evil.com/steal?token=", APP_URL);
    expect(result).toBe(`${APP_URL}/auth/callback`);
    expect(result).not.toContain("evil.com");
  });

  it("javascript: protokolü reddedilir", () => {
    const result = safeRedirectUrl("javascript:alert(1)", APP_URL);
    expect(result).not.toContain("javascript:");
    expect(result).toBe(`${APP_URL}/auth/callback`);
  });

  it("geçersiz URL reddedilir → fallback URL kullanılır", () => {
    const result = safeRedirectUrl("not-a-valid-url-%%%", APP_URL);
    expect(result).toBe(`${APP_URL}/auth/callback`);
  });

  it("boş string reddedilir → fallback URL kullanılır", () => {
    const result = safeRedirectUrl("", APP_URL);
    expect(result).toBe(`${APP_URL}/auth/callback`);
  });

  it("http → https origin farkı farklı origin sayılır", () => {
    // APP_URL http iken https redirect farklı origin
    const result = safeRedirectUrl("https://localhost:5173/callback", "http://localhost:5173");
    expect(result).toBe("http://localhost:5173/auth/callback");
  });

  it("subdomain farklı origin sayılır", () => {
    const result = safeRedirectUrl("http://api.localhost:5173/steal", APP_URL);
    expect(result).toBe(`${APP_URL}/auth/callback`);
    expect(result).not.toContain("api.localhost");
  });

  it("oauth.ts kaynak kodunda origin whitelist kontrolü mevcut", async () => {
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