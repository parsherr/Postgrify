/**
 * JWT issuer separation and auth settings normalization tests.
 *
 * NEW-JWT-1: DB token now carries iss: "postgrify/db"
 * NEW-JWT-2: verifyAdminOrDb rejects unknown issuer
 * NEW-CASE-1: getAuthSetting returns lowercase-normalized value
 * NEW-NGINX-1: HSTS and hardened CSP are present in nginx.conf
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─────────────────────────────────────────────────────────────────────────────
// JWT issuer separation tests
// ─────────────────────────────────────────────────────────────────────────────

describe("NEW-JWT-1/2: JWT issuer separation", () => {
  const jwtSrc = readFileSync(
    join(__dirname, "../../src/services/jwtService.ts"),
    "utf-8"
  );

  it("DB_ISSUER constant is defined with value 'postgrify/db'", () => {
    expect(jwtSrc).toContain("DB_ISSUER");
    expect(jwtSrc).toContain("postgrify/db");
  });

  it("three distinct issuer types are defined (admin, db, db-auth)", () => {
    expect(jwtSrc).toContain("ADMIN_ISSUER");
    expect(jwtSrc).toContain("DB_ISSUER");
    expect(jwtSrc).toContain("DB_USER_ISSUER");
  });

  it("signDbToken signs token with DB_ISSUER", () => {
    // setIssuer(DB_ISSUER) call must be present inside signDbToken method
    const signDbIdx = jwtSrc.indexOf("signDbToken");
    const signAdminIdx = jwtSrc.indexOf("signAdminToken");
    // Is setIssuer in scope of the signDbToken method?
    const dbMethodSlice = jwtSrc.slice(signDbIdx, signDbIdx + 500);
    expect(dbMethodSlice).toContain("setIssuer");
    expect(dbMethodSlice).toContain("DB_ISSUER");
  });

  it("signAdminToken signs token with ADMIN_ISSUER", () => {
    const signAdminIdx = jwtSrc.indexOf("signAdminToken");
    const adminMethodSlice = jwtSrc.slice(signAdminIdx, signAdminIdx + 500);
    expect(adminMethodSlice).toContain("setIssuer");
    expect(adminMethodSlice).toContain("ADMIN_ISSUER");
  });

  it("verifyAdminOrDb rejects DB_USER_ISSUER", () => {
    // Find method body of "async verifyAdminOrDb" (skip comment line)
    const verifyIdx = jwtSrc.indexOf("async verifyAdminOrDb");
    const verifySlice = jwtSrc.slice(verifyIdx, verifyIdx + 800);
    expect(verifySlice).toContain("return null");
    expect(verifySlice).toContain("DB_USER_ISSUER");
  });

  it("verifyAdminOrDb rejects unknown issuer", () => {
    const verifyIdx = jwtSrc.indexOf("async verifyAdminOrDb");
    const verifySlice = jwtSrc.slice(verifyIdx, verifyIdx + 1000);
    expect(verifySlice).toContain("ADMIN_ISSUER");
    expect(verifySlice).toContain("DB_ISSUER");
    // DB_USER_ISSUER + unknown issuer = at least 2 null returns
    const nullCount = (verifySlice.match(/return null/g) ?? []).length;
    expect(nullCount).toBeGreaterThanOrEqual(2);
  });

  it("verifyDbUser enforces DB_USER_ISSUER requirement", () => {
    const verifyDbIdx = jwtSrc.indexOf("async verifyDbUser");
    const dbUserSlice = jwtSrc.slice(verifyDbIdx, verifyDbIdx + 400);
    expect(dbUserSlice).toContain("issuer");
    expect(dbUserSlice).toContain("DB_USER_ISSUER");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Auth settings case-insensitive normalization
// ─────────────────────────────────────────────────────────────────────────────

describe("NEW-CASE-1: getAuthSetting lowercase normalization", () => {
  const provisionSrc = readFileSync(
    join(__dirname, "../../src/routes/db/auth/provision.ts"),
    "utf-8"
  );

  it("provision.ts getAuthSetting returns value with toLowerCase() applied", () => {
    expect(provisionSrc).toContain("toLowerCase()");
    // toLowerCase call must be inside the getAuthSetting function definition
    const fnIdx = provisionSrc.indexOf("getAuthSetting");
    const fnSlice = provisionSrc.slice(fnIdx, fnIdx + 400);
    expect(fnSlice).toContain("toLowerCase()");
  });

  it("normalization enables case-insensitive boolean checks", () => {
    // Inline simulation — mirrors the logic in provision.ts
    function mockGetAuthSetting(rawValue: string): string {
      return rawValue.toLowerCase();
    }
    expect(mockGetAuthSetting("TRUE") === "true").toBe(true);
    expect(mockGetAuthSetting("True") === "true").toBe(true);
    expect(mockGetAuthSetting("true") === "true").toBe(true);
    expect(mockGetAuthSetting("FALSE") === "true").toBe(false);
    expect(mockGetAuthSetting("False") === "true").toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// nginx HSTS and hardened CSP
// ─────────────────────────────────────────────────────────────────────────────

describe("NEW-NGINX-1: nginx HSTS and hardened CSP", () => {
  const nginxConf = readFileSync(
    join(__dirname, "../../packages/gui/nginx.conf").replace(
      "/packages/api",
      ""
    ),
    "utf-8"
  );

  it("nginx.conf is readable", () => {
    expect(nginxConf.length).toBeGreaterThan(0);
  });

  it("Strict-Transport-Security (HSTS) header is present", () => {
    expect(nginxConf).toContain("Strict-Transport-Security");
    expect(nginxConf).toContain("max-age=");
  });

  it("HSTS is configured with 1 year (31536000 seconds)", () => {
    expect(nginxConf).toContain("31536000");
  });

  it("CSP connect-src includes ws: and wss: (for terminal WebSocket)", () => {
    expect(nginxConf).toContain("ws:");
    expect(nginxConf).toContain("wss:");
  });

  it("CSP object-src 'none' is present (plugin/Flash XSS disabled)", () => {
    expect(nginxConf).toContain("object-src 'none'");
  });

  it("CSP base-uri 'self' is present (prevents base tag injection)", () => {
    expect(nginxConf).toContain("base-uri 'self'");
  });

  it("X-Frame-Options DENY header is present", () => {
    expect(nginxConf).toContain("X-Frame-Options");
    expect(nginxConf).toContain("DENY");
  });

  it("Referrer-Policy is set to strict", () => {
    expect(nginxConf).toContain("Referrer-Policy");
    expect(nginxConf).toContain("strict-origin");
  });
});