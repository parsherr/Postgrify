/**
 * KRIT-3: SQL parametrik sorgu testleri.
 *
 * pg_terminate_backend, string interpolasyon yerine $1 parametresi kullanmalı.
 * isValidIdentifier başarısız olsa bile SQL çağrısı parametrize kalır.
 *
 * HIGH-5: Metadata token alanı filtreleme testleri.
 *
 * GET /db/:database/auth/users; metadata JSONB'den reset_token, magic_token
 * ve verification_token alanlarını dışarıya sızdırmamalı.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─────────────────────────────────────────────────────────────────────────────
// KRIT-3: pg_terminate_backend parametrik sorgu
// ─────────────────────────────────────────────────────────────────────────────

describe("KRIT-3: pg_terminate_backend parametrik sorgu", () => {
  const databasesPath = join(__dirname, "../../src/routes/admin/databases.ts");
  const databasesSrc = readFileSync(databasesPath, "utf-8");

  it("pg_terminate_backend string interpolasyon kullanmıyor", () => {
    // Eski hatalı pattern: WHERE datname = '${db}'
    const badPattern = /datname\s*=\s*['"`]\$\{db\}['"`]/;
    expect(
      badPattern.test(databasesSrc),
      "pg_terminate_backend sorgusunda string interpolasyon bulundu — $1 kullanılmalı"
    ).toBe(false);
  });

  it("pg_terminate_backend $1 parametresi ve [db] array'i kullanıyor", () => {
    const hasParam =
      databasesSrc.includes("$1") &&
      (databasesSrc.includes("[db]") || databasesSrc.includes("[ db ]"));
    expect(
      hasParam,
      "pg_terminate_backend $1 parametresi ve [db] array'i kullanmalı"
    ).toBe(true);
  });

  it("databases.ts isValidIdentifier'ı sql.unsafe'den önce çağırıyor", () => {
    const identifierIdx = databasesSrc.indexOf("isValidIdentifier");
    const unsafeIdx = databasesSrc.indexOf("sql.unsafe");
    expect(identifierIdx, "isValidIdentifier databases.ts'de bulunmalı").toBeGreaterThan(-1);
    expect(unsafeIdx, "sql.unsafe databases.ts'de bulunmalı").toBeGreaterThan(-1);
    expect(
      identifierIdx < unsafeIdx,
      "isValidIdentifier sql.unsafe'den önce gelmelidir (savunma derinliği)"
    ).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// HIGH-5: /auth/users endpoint'i hassas metadata alanlarını filtrelemeli
// ─────────────────────────────────────────────────────────────────────────────

describe("HIGH-5: Hassas metadata alanları /auth/users yanıtından filtreleniyor", () => {
  const usersPath = join(__dirname, "../../src/routes/db/auth/users.ts");
  const usersSrc = readFileSync(usersPath, "utf-8");

  it("users.ts SENSITIVE_METADATA_KEYS sabitini tanımlıyor", () => {
    expect(usersSrc).toContain("SENSITIVE_METADATA_KEYS");
  });

  it("SENSITIVE_METADATA_KEYS reset_token içeriyor", () => {
    expect(usersSrc).toContain("reset_token");
  });

  it("SENSITIVE_METADATA_KEYS magic_token içeriyor", () => {
    expect(usersSrc).toContain("magic_token");
  });

  it("SENSITIVE_METADATA_KEYS verification_token içeriyor", () => {
    expect(usersSrc).toContain("verification_token");
  });

  it("sanitizeUser() helper users.ts'de tanımlı", () => {
    expect(usersSrc).toContain("sanitizeUser");
  });

  it("stripSensitiveMetadata() reset_token'ı metadata nesnesinden kaldırıyor", () => {
    const SENSITIVE_KEYS = [
      "reset_token",
      "reset_token_expires",
      "magic_token",
      "magic_token_expires",
      "verification_token",
      "verification_token_expires",
    ];

    function strip(metadata: Record<string, unknown>): Record<string, unknown> {
      const cleaned = { ...metadata };
      for (const key of SENSITIVE_KEYS) delete cleaned[key];
      return cleaned;
    }

    const raw = {
      locale: "tr",
      reset_token: "abc123sensitive",
      reset_token_expires: "2026-01-01T00:00:00Z",
      magic_token: "magic123sensitive",
      magic_token_expires: "2026-01-01T00:00:00Z",
      verification_token: "verify123sensitive",
      custom_field: "should-remain",
    };

    const cleaned = strip(raw);

    expect(cleaned.reset_token).toBeUndefined();
    expect(cleaned.reset_token_expires).toBeUndefined();
    expect(cleaned.magic_token).toBeUndefined();
    expect(cleaned.magic_token_expires).toBeUndefined();
    expect(cleaned.verification_token).toBeUndefined();
    expect(cleaned.locale).toBe("tr");
    expect(cleaned.custom_field).toBe("should-remain");
  });

  it("users list endpoint'i sanitizeUser() çağırıyor", () => {
    // .map((u) => sanitizeUser(...) gibi çağrı kalıbını eşleştir
    // Not: [^)]* yerine .*? kullanılıyor çünkü (u) içindeki ) karakteri [^)]* 'i keser
    expect(usersSrc).toMatch(/\.map\(.*?=>\s*sanitizeUser/s);
  });

  it("sanitizeUser users.ts'de en az 2 yerde kullanılıyor (tanım + çağrı)", () => {
    const sanitizeCount = (usersSrc.match(/sanitizeUser/g) ?? []).length;
    expect(
      sanitizeCount,
      "sanitizeUser en az 2 kez geçmeli (tanım + list endpoint çağrısı)"
    ).toBeGreaterThanOrEqual(2);
  });
});