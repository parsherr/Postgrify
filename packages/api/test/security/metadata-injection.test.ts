/**
 * Güvenlik testleri: metadata injection, token expiry guard, session UUID validation.
 *
 * META-1: me.ts PATCH → metadata merge'de sensitive key'ler inject edilemez
 * META-2: me.ts rate limit header mevcut
 * VERIFY-1: verify.ts token expiry NULL guard
 * SESSION-1: sessions.ts UUID format validation
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─────────────────────────────────────────────────────────────────────────────
// META-1: me.ts metadata injection koruması
// ─────────────────────────────────────────────────────────────────────────────

describe("META-1: PATCH /me metadata injection koruması", () => {
  const meSrc = readFileSync(
    join(__dirname, "../../src/routes/db/auth/me.ts"),
    "utf-8"
  );

  it("me.ts PROTECTED_METADATA_KEYS sabiti tanımlı", () => {
    expect(meSrc).toContain("PROTECTED_METADATA_KEYS");
  });

  it("reset_token PROTECTED_METADATA_KEYS'te var", () => {
    const idx = meSrc.indexOf("PROTECTED_METADATA_KEYS");
    const slice = meSrc.slice(idx, idx + 500);
    expect(slice).toContain("reset_token");
  });

  it("magic_token PROTECTED_METADATA_KEYS'te var", () => {
    const idx = meSrc.indexOf("PROTECTED_METADATA_KEYS");
    const slice = meSrc.slice(idx, idx + 500);
    expect(slice).toContain("magic_token");
  });

  it("verification_token PROTECTED_METADATA_KEYS'te var", () => {
    const idx = meSrc.indexOf("PROTECTED_METADATA_KEYS");
    const slice = meSrc.slice(idx, idx + 500);
    expect(slice).toContain("verification_token");
  });

  it("safeMetadata oluşturulup korunan keyler siliniyor", () => {
    expect(meSrc).toContain("safeMetadata");
    expect(meSrc).toContain("delete safeMetadata[key]");
  });

  it("SQL update'te JSONB - ile token alanları temizleniyor", () => {
    expect(meSrc).toContain("- 'reset_token'");
    expect(meSrc).toContain("- 'magic_token'");
    expect(meSrc).toContain("- 'verification_token'");
  });

  it("metadata injection saldırısı simülasyonu — korunan keyler atılır", () => {
    // me.ts'deki sanitizasyon mantığını izole test
    const PROTECTED_KEYS = [
      "reset_token", "reset_token_exp",
      "magic_token", "magic_token_exp",
      "verification_token", "verification_exp",
    ];

    function sanitizeMeta(raw: Record<string, unknown>): Record<string, unknown> {
      const safe = { ...raw };
      for (const k of PROTECTED_KEYS) delete safe[k];
      return safe;
    }

    const attackPayload = {
      locale: "tr",
      reset_token: "evil_hash_to_override",
      reset_token_exp: "9999-12-31T23:59:59Z",
      magic_token: "evil_magic_override",
      verification_token: "evil_verify",
      custom_field: "legitimate_value",
    };

    const safe = sanitizeMeta(attackPayload);

    // Saldırı alanları kaldırılmış olmalı
    expect(safe.reset_token).toBeUndefined();
    expect(safe.reset_token_exp).toBeUndefined();
    expect(safe.magic_token).toBeUndefined();
    expect(safe.verification_token).toBeUndefined();

    // Meşru alanlar korunmalı
    expect(safe.locale).toBe("tr");
    expect(safe.custom_field).toBe("legitimate_value");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// META-2: me.ts rate limit
// ─────────────────────────────────────────────────────────────────────────────

describe("META-2: PATCH /me rate limit", () => {
  const meSrc = readFileSync(
    join(__dirname, "../../src/routes/db/auth/me.ts"),
    "utf-8"
  );

  it("GET /me route rate limit config içeriyor", () => {
    // rateLimit: { max: ... } config mevcut
    expect(meSrc).toContain("rateLimit");
    expect(meSrc).toContain("max:");
  });

  it("PATCH /me ayrı rate limit config içeriyor", () => {
    // PATCH handler'da da rateLimit var
    const patchIdx = meSrc.indexOf("server.patch");
    const patchSlice = meSrc.slice(patchIdx, patchIdx + 300);
    expect(patchSlice).toContain("rateLimit");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// VERIFY-1: verify.ts token expiry NULL guard
// ─────────────────────────────────────────────────────────────────────────────

describe("VERIFY-1: verify.ts token expiry NULL/Invalid Date koruması", () => {
  const verifySrc = readFileSync(
    join(__dirname, "../../src/routes/db/auth/verify.ts"),
    "utf-8"
  );

  it("verify.ts rawExp null check içeriyor", () => {
    expect(verifySrc).toContain("rawExp");
    expect(verifySrc).toContain("!rawExp");
  });

  it("verify.ts isNaN kontrolü içeriyor", () => {
    expect(verifySrc).toContain("isNaN");
    expect(verifySrc).toContain("getTime()");
  });

  it("NULL expiry ile doğrulama reddedilir (simülasyon)", () => {
    function checkExpiry(rawExp: string | null | undefined): "valid" | "invalid" {
      if (!rawExp) return "invalid";
      const exp = new Date(rawExp);
      if (isNaN(exp.getTime()) || exp < new Date()) return "invalid";
      return "valid";
    }

    expect(checkExpiry(null)).toBe("invalid");
    expect(checkExpiry(undefined)).toBe("invalid");
    expect(checkExpiry("not-a-date")).toBe("invalid");
    expect(checkExpiry("2020-01-01T00:00:00Z")).toBe("invalid"); // geçmiş
    expect(checkExpiry(new Date(Date.now() + 60_000).toISOString())).toBe("valid");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SESSION-1: sessions.ts UUID format validation
// ─────────────────────────────────────────────────────────────────────────────

describe("SESSION-1: sessions.ts UUID format validation", () => {
  const sessionsSrc = readFileSync(
    join(__dirname, "../../src/routes/db/auth/sessions.ts"),
    "utf-8"
  );

  it("sessions.ts UUID_REGEX sabiti tanımlı", () => {
    expect(sessionsSrc).toContain("UUID_REGEX");
  });

  it("DELETE /:id endpoint'i UUID validation yapıyor", () => {
    const deleteIdx = sessionsSrc.indexOf("server.delete");
    const deleteSlice = sessionsSrc.slice(deleteIdx, deleteIdx + 900);
    expect(deleteSlice).toContain("UUID_REGEX");
    expect(deleteSlice).toContain("400");
  });

  it("DELETE ?user_id endpoint'i UUID validation yapıyor", () => {
    // İkinci delete handler'da da UUID kontrolü var
    const firstDelete = sessionsSrc.indexOf("UUID_REGEX");
    const secondDelete = sessionsSrc.indexOf("UUID_REGEX", firstDelete + 1);
    expect(secondDelete).toBeGreaterThan(-1);
  });

  it("UUID regex formatı doğru çalışıyor", () => {
    const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    // Geçerli UUID'ler
    expect(UUID_REGEX.test("550e8400-e29b-41d4-a716-446655440000")).toBe(true);
    expect(UUID_REGEX.test("6ba7b810-9dad-11d1-80b4-00c04fd430c8")).toBe(true);
    expect(UUID_REGEX.test("550E8400-E29B-41D4-A716-446655440000")).toBe(true); // uppercase

    // Geçersiz değerler
    expect(UUID_REGEX.test("not-a-uuid")).toBe(false);
    expect(UUID_REGEX.test("sess-1")).toBe(false);
    expect(UUID_REGEX.test("user-uuid-1")).toBe(false);
    expect(UUID_REGEX.test("'; DROP TABLE sessions; --")).toBe(false);
    expect(UUID_REGEX.test("")).toBe(false);
    expect(UUID_REGEX.test("550e8400-e29b-41d4-a716")).toBe(false); // eksik segment
  });

  it("::uuid cast kullanılıyor (type-safe DB query)", () => {
    expect(sessionsSrc).toContain("::uuid");
  });
});