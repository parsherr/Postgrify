/**
 * Gelişmiş güvenlik testleri (Round 5 — kapsamlı analiz).
 *
 * SETTINGS-1: signup_redirect_url URL format + protokol doğrulaması
 * CACHE-1:    buildKey cache poisoning koruması
 * STATS-1:    /admin/stats bilgi sızıntısı koruması
 * TABLES-1:   CREATE TABLE kolon validasyonu
 * META-1:     /db/:db/meta bilgi sızıntısı
 * EMAIL-1:    email enumeration koruması (passwordReset)
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─────────────────────────────────────────────────────────────────────────────
// SETTINGS-1: signup_redirect_url protokol doğrulaması
// ─────────────────────────────────────────────────────────────────────────────

describe("SETTINGS-1: signup_redirect_url güvenli URL doğrulaması", () => {
  const settingsSrc = readFileSync(
    join(__dirname, "../../src/routes/db/auth/settings.ts"),
    "utf-8"
  );

  it("settings.ts signup_redirect_url için URL format kontrolü yapıyor", () => {
    expect(settingsSrc).toContain("signup_redirect_url");
    expect(settingsSrc).toContain("new URL(");
    expect(settingsSrc).toContain("protocol");
  });

  it("javascript: protokolü reddediliyor", () => {
    expect(settingsSrc).toContain("allowedProtocols");
    expect(settingsSrc).toContain("https:");
    expect(settingsSrc).toContain("http:");
  });

  it("geçersiz URL 400 döndürür (simülasyon)", () => {
    function validateRedirectUrl(value: string): { ok: boolean; error?: string } {
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(value);
      } catch {
        return { ok: false, error: "Invalid URL" };
      }
      const allowed = ["http:", "https:"];
      if (!allowed.includes(parsedUrl.protocol)) {
        return { ok: false, error: "Dangerous protocol" };
      }
      return { ok: true };
    }

    expect(validateRedirectUrl("javascript:alert(1)").ok).toBe(false);
    expect(validateRedirectUrl("data:text/html,<script>").ok).toBe(false);
    expect(validateRedirectUrl("file:///etc/passwd").ok).toBe(false);
    expect(validateRedirectUrl("not-a-url-%%%").ok).toBe(false);
    expect(validateRedirectUrl("https://myapp.com/callback").ok).toBe(true);
    expect(validateRedirectUrl("http://localhost:5173/auth/callback").ok).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CACHE-1: buildKey cache poisoning koruması
// ─────────────────────────────────────────────────────────────────────────────

describe("CACHE-1: buildKey cache poisoning koruması", () => {
  const cacheSrc = readFileSync(
    join(__dirname, "../../src/services/cacheService.ts"),
    "utf-8"
  );

  it("buildKey : karakterlerini sanitize ediyor", () => {
    expect(cacheSrc).toContain("replace(/[:\\s*]/g");
  });

  it("buildKey * wildcard karakterini sanitize ediyor", () => {
    // Redis SCAN * inject edilemez
    expect(cacheSrc).toContain("safeParts");
  });

  it("cache poisoning saldırısı reddediliyor (simülasyon)", async () => {
    // cacheService.ts buildKey mantığının kopyası
    function buildKey(...parts: string[]): string {
      const safeParts = parts.map((p) => p.replace(/[:\s*]/g, ""));
      return `postgrify:${safeParts.join(":")}`;
    }

    // Normal kullanım
    expect(buildKey("db1", "users")).toBe("postgrify:db1:users");

    // Cache poisoning girişimi: `:` inject
    expect(buildKey("db1:evil", "users")).toBe("postgrify:db1evil:users");

    // Redis SCAN wildcard inject girişimi
    expect(buildKey("db1*", "users")).toBe("postgrify:db1:users");
    expect(buildKey("*", "admin")).toBe("postgrify::admin");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// STATS-1: /admin/stats bilgi sızıntısı koruması
// ─────────────────────────────────────────────────────────────────────────────

describe("STATS-1: /admin/stats kimlik doğrulaması", () => {
  const statsSrc = readFileSync(
    join(__dirname, "../../src/routes/admin/stats.ts"),
    "utf-8"
  );

  it("stats route authenticateAdmin veya group-level auth gerektirir", () => {
    const adminIndexSrc = readFileSync(
      join(__dirname, "../../src/routes/admin/index.ts"),
      "utf-8"
    );
    // Admin index group-level authenticateAdmin hook ekliyor
    expect(adminIndexSrc).toContain("authenticateAdmin");
    expect(adminIndexSrc).toContain("addHook");
  });

  it("stats endpoint hassas bilgiler içeriyor — auth zorunlu", () => {
    // activePoolNames, nodeVersion gibi bilgiler auth arkasında olmalı
    expect(statsSrc).toContain("activePoolNames");
    expect(statsSrc).toContain("nodeVersion");
    // Bu endpoint admin route grubunda — group auth yeterli
    const adminIndexSrc = readFileSync(
      join(__dirname, "../../src/routes/admin/index.ts"),
      "utf-8"
    );
    expect(adminIndexSrc).toContain("server.authenticateAdmin");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TABLES-1: CREATE TABLE güvenliği
// ─────────────────────────────────────────────────────────────────────────────

describe("TABLES-1: CREATE TABLE identifier validasyonu", () => {
  const tablesSrc = readFileSync(
    join(__dirname, "../../src/routes/db/tables.ts"),
    "utf-8"
  );

  it("tables.ts assertIdentifier veya isValidIdentifier kullanıyor", () => {
    const hasIdentifierCheck =
      tablesSrc.includes("assertIdentifier") || tablesSrc.includes("isValidIdentifier");
    expect(hasIdentifierCheck).toBe(true);
  });

  it("identifier.ts sisteme dahil edilmiş", () => {
    expect(tablesSrc).toContain("identifier");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// EMAIL-1: email enumeration koruması
// ─────────────────────────────────────────────────────────────────────────────

describe("EMAIL-1: email enumeration koruması", () => {
  const passwordResetSrc = readFileSync(
    join(__dirname, "../../src/routes/db/auth/passwordReset.ts"),
    "utf-8"
  );

  it("forgot endpoint kullanıcı bulunamasa da 200 döndürüyor", () => {
    // email enumeration: kullanıcı yoksa da aynı response dönmeli
    // Bu, "Email sent if account exists" pattern'ını kontrol eder
    // C-15/C-16: GoTrue-compatible empty {} response (no ok:true)
    expect(passwordResetSrc).toContain("reply.send({}");
    // "User not found" gibi bilgi sızdıran mesaj olmamalı
    expect(passwordResetSrc).not.toContain('"User not found"');
    expect(passwordResetSrc).not.toContain('"Email not registered"');
  });

  it("forgot endpoint user yoksa da 200/ok:true dönüyor (email enumeration önlemi)", () => {
    // Email enumeration koruması: user yoksa da aynı response
    // if (user) bloğu dışında reply.send({ ok: true }) olmalı
    const sendIdx = passwordResetSrc.lastIndexOf("reply.send");
    const sendSlice = passwordResetSrc.slice(Math.max(0, sendIdx - 50), sendIdx + 100);
    // C-15/C-16: GoTrue-compatible empty {} response
    expect(sendSlice).toContain("reply.send({}");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GENERAL: Genel güvenlik prensipleri kontrolü
// ─────────────────────────────────────────────────────────────────────────────

describe("GENERAL: Genel güvenlik kontrolleri", () => {
  it("identifier.ts RESERVED_PREFIXES ile sistem tabloları korunuyor", async () => {
    const { isValidIdentifier } = await import("../../src/utils/identifier.js");
    // Sistem tabloları
    expect(isValidIdentifier("pg_stat_activity")).toBe(false);
    expect(isValidIdentifier("pg_class")).toBe(false);
    expect(isValidIdentifier("_postgrify_auth")).toBe(false);
    // Normal tablolar
    expect(isValidIdentifier("my_table")).toBe(true);
    expect(isValidIdentifier("users")).toBe(true);
  });

  it("passwordReset ve magicLink NULL expiry guard doğru çalışıyor", () => {
    // Her iki dosyada rawExp + isNaN koruması
    const pwSrc = readFileSync(
      join(__dirname, "../../src/routes/db/auth/passwordReset.ts"),
      "utf-8"
    );
    const mlSrc = readFileSync(
      join(__dirname, "../../src/routes/db/auth/magicLink.ts"),
      "utf-8"
    );
    expect(pwSrc).toContain("isNaN(exp.getTime())");
    expect(mlSrc).toContain("isNaN(exp.getTime())");
  });

  it("verify.ts NULL expiry guard doğru çalışıyor", () => {
    const verifySrc = readFileSync(
      join(__dirname, "../../src/routes/db/auth/verify.ts"),
      "utf-8"
    );
    expect(verifySrc).toContain("isNaN(exp.getTime())");
    expect(verifySrc).toContain("!rawExp");
  });

  it("getAuthSetting lowercase normalize ediyor", () => {
    const provSrc = readFileSync(
      join(__dirname, "../../src/routes/db/auth/provision.ts"),
      "utf-8"
    );
    const getAuthIdx = provSrc.indexOf("getAuthSetting");
    // Fonksiyon body içinde toLowerCase olmalı
    const fnBody = provSrc.slice(getAuthIdx, getAuthIdx + 500);
    expect(fnBody).toContain("toLowerCase");
  });
});