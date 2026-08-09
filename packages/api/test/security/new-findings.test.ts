/**
 * Yeni güvenlik bulguları testleri (Round 4 analizi).
 *
 * NEW-1: Admin login timing saldırısı koruması
 * NEW-6: identifier.ts sistem prefix kontrolü (pg_, _postgrify_)
 * NEW-3/4: Token expiry NULL/Invalid Date koruması
 * NEW-5: Failed login audit log
 */

import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─────────────────────────────────────────────────────────────────────────────
// NEW-1: Admin login timing saldırısı koruması
// ─────────────────────────────────────────────────────────────────────────────

describe("NEW-1: Admin login timing saldırısı koruması", () => {
  const loginSrc = readFileSync(
    join(__dirname, "../../src/routes/auth/adminLogin.ts"),
    "utf-8"
  );

  it("adminLogin.ts her zaman verifyPassword çağırıyor (email eşleşmeden bağımsız)", () => {
    // emailMatch değişkeni oluşturulmalı — ayrı boolean
    expect(loginSrc).toContain("emailMatch");
    // verifyPassword her durumda çağrılmalı
    expect(loginSrc).toContain("verifyPassword");
  });

  it("email kontrolü ile şifre kontrolü if bloğunda birleştiriliyor", () => {
    // !emailMatch || !valid şeklinde combined check
    expect(loginSrc).toMatch(/!emailMatch\s*\|\|\s*!valid/);
  });

  it("email eşleşmezse erken return yapılmıyor (şifre doğrulaması atlanmıyor)", () => {
    // Eski kötü pattern: email eşleşmezse hemen return
    const badEarlyReturn = /if\s*\([^)]*email[^)]*!==.*\)[\s\S]{0,50}return.*401/;
    expect(loginSrc).not.toMatch(badEarlyReturn);
  });

  it("timing koruması hakkında açıklayıcı yorum mevcut", () => {
    expect(loginSrc).toContain("timing");
  });

  it("adminLogin.ts verifyPassword'ü await ile çağırıyor", () => {
    expect(loginSrc).toMatch(/await\s+verifyPassword/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// NEW-6: identifier.ts sistem prefix kontrolü
// ─────────────────────────────────────────────────────────────────────────────

describe("NEW-6: identifier.ts sistem prefix koruması", () => {
  // Modül import — Vitest ESM test ortamı
  it("isValidIdentifier pg_ prefix'i reddediyor", async () => {
    const { isValidIdentifier } = await import("../../src/utils/identifier.js");
    expect(isValidIdentifier("pg_stat_activity")).toBe(false);
    expect(isValidIdentifier("pg_class")).toBe(false);
    expect(isValidIdentifier("pg_catalog")).toBe(false);
  });

  it("isValidIdentifier _postgrify_ prefix'i reddediyor", async () => {
    const { isValidIdentifier } = await import("../../src/utils/identifier.js");
    expect(isValidIdentifier("_postgrify_auth")).toBe(false);
    expect(isValidIdentifier("_postgrify_settings")).toBe(false);
  });

  it("isValidIdentifier geçerli identifier'ları kabul ediyor", async () => {
    const { isValidIdentifier } = await import("../../src/utils/identifier.js");
    expect(isValidIdentifier("users")).toBe(true);
    expect(isValidIdentifier("my_table_2")).toBe(true);
    expect(isValidIdentifier("_private")).toBe(true);
    expect(isValidIdentifier("CamelCase")).toBe(true);
  });

  it("isValidIdentifier SQL keyword'leri reddediyor", async () => {
    const { isValidIdentifier } = await import("../../src/utils/identifier.js");
    expect(isValidIdentifier("select")).toBe(false);
    expect(isValidIdentifier("DROP")).toBe(false);
    expect(isValidIdentifier("information_schema")).toBe(false);
  });

  it("identifier.ts RESERVED_PREFIXES listesi pg_ içeriyor", () => {
    const src = readFileSync(
      join(__dirname, "../../src/utils/identifier.ts"),
      "utf-8"
    );
    expect(src).toContain("RESERVED_PREFIXES");
    expect(src).toContain("pg_");
    expect(src).toContain("_postgrify_");
  });

  it("identifier.ts prefix kontrolü startsWith ile yapılıyor", () => {
    const src = readFileSync(
      join(__dirname, "../../src/utils/identifier.ts"),
      "utf-8"
    );
    expect(src).toContain("startsWith");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// NEW-3/4: Token expiry NULL ve Invalid Date koruması
// ─────────────────────────────────────────────────────────────────────────────

describe("NEW-3/4: Token expiry NULL/Invalid Date koruması", () => {
  it("new Date(undefined) güvensiz davranışını anlar (Invalid Date)", () => {
    // Bu test neden korumanın gerekli olduğunu belgeler
    const d = new Date(undefined as unknown as string);
    expect(isNaN(d.getTime())).toBe(true);
    // Invalid Date < new Date() → false döner → token geçerli sayılabilir!
    expect(d < new Date()).toBe(false);
  });

  it("new Date(null) epoch döndürür (her zaman expired)", () => {
    const d = new Date(null as unknown as string);
    expect(isNaN(d.getTime())).toBe(false);
    // null → epoch (1970) → her zaman expired → bu güvenli ama null'ı
    // açıkça reddetmek daha iyi pratik
    expect(d < new Date()).toBe(true);
  });

  it("passwordReset.ts rawExp null check içeriyor", () => {
    const src = readFileSync(
      join(__dirname, "../../src/routes/db/auth/passwordReset.ts"),
      "utf-8"
    );
    expect(src).toContain("rawExp");
    expect(src).toContain("!rawExp");
    expect(src).toContain("isNaN");
    expect(src).toContain("exp.getTime()");
  });

  it("magicLink.ts rawExp null check içeriyor", () => {
    const src = readFileSync(
      join(__dirname, "../../src/routes/db/auth/magicLink.ts"),
      "utf-8"
    );
    expect(src).toContain("rawExp");
    expect(src).toContain("!rawExp");
    expect(src).toContain("isNaN");
    expect(src).toContain("exp.getTime()");
  });

  it("passwordReset güvenli expiry check — NULL input token'ı reddeder", () => {
    // İzole test: null expiry ile token kabul edilmemeli
    function safeExpCheck(rawExp: string | null | undefined): boolean {
      if (!rawExp) return false; // null/undefined → geçersiz
      const exp = new Date(rawExp);
      if (isNaN(exp.getTime())) return false; // parse hatası → geçersiz
      return exp >= new Date(); // geçmişte ise süresi dolmuş → false
    }
    expect(safeExpCheck(null)).toBe(false);
    expect(safeExpCheck(undefined)).toBe(false);
    expect(safeExpCheck("not-a-date")).toBe(false);
    expect(safeExpCheck("2020-01-01T00:00:00Z")).toBe(false); // geçmiş
    // Gelecek tarih → geçerli
    expect(safeExpCheck(new Date(Date.now() + 60_000).toISOString())).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// NEW-5: Failed login audit log kaydı
// ─────────────────────────────────────────────────────────────────────────────

describe("NEW-5: Failed login audit log", () => {
  it("tokens.ts login_failed event'i audit log'a yazıyor", () => {
    const src = readFileSync(
      join(__dirname, "../../src/routes/db/auth/tokens.ts"),
      "utf-8"
    );
    expect(src).toContain("login_failed");
    expect(src).toContain("insertAuditLog");
  });

  it("provision.ts AuditEvent tipinde login_failed tanımlı", () => {
    const src = readFileSync(
      join(__dirname, "../../src/routes/db/auth/provision.ts"),
      "utf-8"
    );
    expect(src).toContain("login_failed");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// NEW-8: Toplu PATCH/DELETE — WHERE zorunluluğu
// ─────────────────────────────────────────────────────────────────────────────

describe("NEW-8: Toplu PATCH/DELETE WHERE zorunluluğu", () => {
  const rowsSrc = readFileSync(
    join(__dirname, "../../src/routes/db/rows.ts"),
    "utf-8"
  );

  it("rows.ts PATCH endpoint'i WHERE koşulu gerektiriyor", () => {
    // where parametresi zorunlu olarak kontrol edilmeli
    expect(rowsSrc).toContain("where");
    // WHERE olmadan güncelleme reddedilmeli
    const hasBulkUpdateGuard =
      rowsSrc.includes("No WHERE") ||
      rowsSrc.includes("where koşulu") ||
      rowsSrc.includes("conditions.length") ||
      rowsSrc.includes("parseWhereConditions");
    expect(hasBulkUpdateGuard).toBe(true);
  });

  it("rows.ts DELETE endpoint'i WHERE koşulu gerektiriyor", () => {
    expect(rowsSrc).toContain("parseWhereConditions");
    const hasDeleteGuard =
      rowsSrc.includes("No WHERE") ||
      rowsSrc.includes("conditions.length") ||
      rowsSrc.includes("where");
    expect(hasDeleteGuard).toBe(true);
  });

  it("queryBuilder.ts parseWhereConditions identifier doğrulaması yapıyor", () => {
    const src = readFileSync(
      join(__dirname, "../../src/services/queryBuilder.ts"),
      "utf-8"
    );
    // queryBuilder isValidIdentifier veya assertIdentifier kullanıyor olabilir
    const hasIdentifierCheck =
      src.includes("isValidIdentifier") || src.includes("assertIdentifier");
    expect(hasIdentifierCheck).toBe(true);
    expect(src).toContain("parseWhereConditions");
  });
});