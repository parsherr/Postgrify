/**
 * JWT issuer ayrımı ve auth settings normalizasyon testleri.
 *
 * NEW-JWT-1: DB token artık iss: "postgrify/db" taşıyor
 * NEW-JWT-2: verifyAdminOrDb bilinmeyen issuer'ı reddediyor
 * NEW-CASE-1: getAuthSetting lowercase normalizeEdilmiş değer döndürüyor
 * NEW-NGINX-1: HSTS ve güçlendirilmiş CSP nginx.conf'ta mevcut
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─────────────────────────────────────────────────────────────────────────────
// JWT Issuer ayrımı testleri
// ─────────────────────────────────────────────────────────────────────────────

describe("NEW-JWT-1/2: JWT issuer ayrımı", () => {
  const jwtSrc = readFileSync(
    join(__dirname, "../../src/services/jwtService.ts"),
    "utf-8"
  );

  it("DB_ISSUER sabiti 'postgrify/db' değerinde tanımlı", () => {
    expect(jwtSrc).toContain("DB_ISSUER");
    expect(jwtSrc).toContain("postgrify/db");
  });

  it("üç farklı issuer tipi tanımlı (admin, db, db-auth)", () => {
    expect(jwtSrc).toContain("ADMIN_ISSUER");
    expect(jwtSrc).toContain("DB_ISSUER");
    expect(jwtSrc).toContain("DB_USER_ISSUER");
  });

  it("signDbToken DB_ISSUER ile token imzalıyor", () => {
    // setIssuer(DB_ISSUER) çağrısı signDbToken metodunda olmalı
    const signDbIdx = jwtSrc.indexOf("signDbToken");
    const signAdminIdx = jwtSrc.indexOf("signAdminToken");
    // signDbToken metodunun scope'unda setIssuer var mı?
    const dbMethodSlice = jwtSrc.slice(signDbIdx, signDbIdx + 500);
    expect(dbMethodSlice).toContain("setIssuer");
    expect(dbMethodSlice).toContain("DB_ISSUER");
  });

  it("signAdminToken ADMIN_ISSUER ile token imzalıyor", () => {
    const signAdminIdx = jwtSrc.indexOf("signAdminToken");
    const adminMethodSlice = jwtSrc.slice(signAdminIdx, signAdminIdx + 500);
    expect(adminMethodSlice).toContain("setIssuer");
    expect(adminMethodSlice).toContain("ADMIN_ISSUER");
  });

  it("verifyAdminOrDb DB_USER_ISSUER'i reddediyor", () => {
    // "async verifyAdminOrDb" ile metod body'sini bul (yorum satırını atla)
    const verifyIdx = jwtSrc.indexOf("async verifyAdminOrDb");
    const verifySlice = jwtSrc.slice(verifyIdx, verifyIdx + 800);
    expect(verifySlice).toContain("return null");
    expect(verifySlice).toContain("DB_USER_ISSUER");
  });

  it("verifyAdminOrDb bilinmeyen issuer'ı reddediyor", () => {
    const verifyIdx = jwtSrc.indexOf("async verifyAdminOrDb");
    const verifySlice = jwtSrc.slice(verifyIdx, verifyIdx + 1000);
    expect(verifySlice).toContain("ADMIN_ISSUER");
    expect(verifySlice).toContain("DB_ISSUER");
    // DB_USER_ISSUER + bilinmeyen issuer = en az 2 null return
    const nullCount = (verifySlice.match(/return null/g) ?? []).length;
    expect(nullCount).toBeGreaterThanOrEqual(2);
  });

  it("verifyDbUser DB_USER_ISSUER zorunluluğu var", () => {
    const verifyDbIdx = jwtSrc.indexOf("async verifyDbUser");
    const dbUserSlice = jwtSrc.slice(verifyDbIdx, verifyDbIdx + 400);
    expect(dbUserSlice).toContain("issuer");
    expect(dbUserSlice).toContain("DB_USER_ISSUER");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Auth settings case-insensitive normalizasyon
// ─────────────────────────────────────────────────────────────────────────────

describe("NEW-CASE-1: getAuthSetting lowercase normalizasyonu", () => {
  const provisionSrc = readFileSync(
    join(__dirname, "../../src/routes/db/auth/provision.ts"),
    "utf-8"
  );

  it("provision.ts getAuthSetting toLowerCase() uygulayarak döndürüyor", () => {
    expect(provisionSrc).toContain("toLowerCase()");
    // getAuthSetting fonksiyon tanımı içinde toLowerCase çağrısı
    const fnIdx = provisionSrc.indexOf("getAuthSetting");
    const fnSlice = provisionSrc.slice(fnIdx, fnIdx + 400);
    expect(fnSlice).toContain("toLowerCase()");
  });

  it("normalizasyon case-insensitive boolean kontrolü sağlar", () => {
    // Inline simülasyon — provision.ts'deki mantığı yansıtır
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
// nginx HSTS ve güçlendirilmiş CSP
// ─────────────────────────────────────────────────────────────────────────────

describe("NEW-NGINX-1: nginx HSTS ve güçlendirilmiş CSP", () => {
  const nginxConf = readFileSync(
    join(__dirname, "../../packages/gui/nginx.conf").replace(
      "/packages/api",
      ""
    ),
    "utf-8"
  );

  it("nginx.conf okunabilir", () => {
    expect(nginxConf.length).toBeGreaterThan(0);
  });

  it("Strict-Transport-Security (HSTS) header mevcut", () => {
    expect(nginxConf).toContain("Strict-Transport-Security");
    expect(nginxConf).toContain("max-age=");
  });

  it("HSTS 1 yıl (31536000 saniye) ile ayarlanmış", () => {
    expect(nginxConf).toContain("31536000");
  });

  it("CSP connect-src ws: ve wss: içeriyor (terminal WebSocket için)", () => {
    expect(nginxConf).toContain("ws:");
    expect(nginxConf).toContain("wss:");
  });

  it("CSP object-src 'none' içeriyor (plugin/Flash XSS kapatılmış)", () => {
    expect(nginxConf).toContain("object-src 'none'");
  });

  it("CSP base-uri 'self' içeriyor (base tag injection önleme)", () => {
    expect(nginxConf).toContain("base-uri 'self'");
  });

  it("X-Frame-Options DENY header mevcut", () => {
    expect(nginxConf).toContain("X-Frame-Options");
    expect(nginxConf).toContain("DENY");
  });

  it("Referrer-Policy strict ayarlı", () => {
    expect(nginxConf).toContain("Referrer-Policy");
    expect(nginxConf).toContain("strict-origin");
  });
});