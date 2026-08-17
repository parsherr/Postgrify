/**
 * Security tests: metadata injection, token expiry guard, session UUID validation.
 *
 * META-1: me.ts PATCH → sensitive keys cannot be injected via metadata merge
 * META-2: me.ts rate limit header is present
 * VERIFY-1: verify.ts token expiry NULL guard
 * SESSION-1: sessions.ts UUID format validation
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─────────────────────────────────────────────────────────────────────────────
// META-1: me.ts metadata injection protection
// ─────────────────────────────────────────────────────────────────────────────

describe("META-1: PATCH /me metadata injection protection", () => {
  const meSrc = readFileSync(
    join(__dirname, "../../src/routes/db/auth/me.ts"),
    "utf-8"
  );

  it("me.ts defines PROTECTED_METADATA_KEYS constant", () => {
    expect(meSrc).toContain("PROTECTED_METADATA_KEYS");
  });

  it("reset_token is in PROTECTED_METADATA_KEYS", () => {
    const idx = meSrc.indexOf("PROTECTED_METADATA_KEYS");
    const slice = meSrc.slice(idx, idx + 500);
    expect(slice).toContain("reset_token");
  });

  it("magic_token is in PROTECTED_METADATA_KEYS", () => {
    const idx = meSrc.indexOf("PROTECTED_METADATA_KEYS");
    const slice = meSrc.slice(idx, idx + 500);
    expect(slice).toContain("magic_token");
  });

  it("verification_token is in PROTECTED_METADATA_KEYS", () => {
    const idx = meSrc.indexOf("PROTECTED_METADATA_KEYS");
    const slice = meSrc.slice(idx, idx + 500);
    expect(slice).toContain("verification_token");
  });

  it("safeMetadata is created and protected keys are deleted", () => {
    expect(meSrc).toContain("safeMetadata");
    expect(meSrc).toContain("delete safeMetadata[key]");
  });

  it("token fields are stripped from JSONB in SQL update via - operator", () => {
    expect(meSrc).toContain("- 'reset_token'");
    expect(meSrc).toContain("- 'magic_token'");
    expect(meSrc).toContain("- 'verification_token'");
  });

  it("metadata injection attack simulation — protected keys are dropped", () => {
    // Isolated test of the sanitization logic in me.ts
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

    // Attack fields must have been removed
    expect(safe.reset_token).toBeUndefined();
    expect(safe.reset_token_exp).toBeUndefined();
    expect(safe.magic_token).toBeUndefined();
    expect(safe.verification_token).toBeUndefined();

    // Legitimate fields must be preserved
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

  it("GET /me route contains rate limit config", () => {
    // rateLimit: { max: ... } config must be present
    expect(meSrc).toContain("rateLimit");
    expect(meSrc).toContain("max:");
  });

  it("PATCH /me contains separate rate limit config", () => {
    // rateLimit must also be present in the PATCH handler
    const patchIdx = meSrc.indexOf("server.patch");
    const patchSlice = meSrc.slice(patchIdx, patchIdx + 300);
    expect(patchSlice).toContain("rateLimit");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// VERIFY-1: verify.ts token expiry NULL guard
// ─────────────────────────────────────────────────────────────────────────────

describe("VERIFY-1: verify.ts token expiry NULL/Invalid Date protection", () => {
  const verifySrc = readFileSync(
    join(__dirname, "../../src/routes/db/auth/verify.ts"),
    "utf-8"
  );

  it("verify.ts contains rawExp null check", () => {
    expect(verifySrc).toContain("rawExp");
    expect(verifySrc).toContain("!rawExp");
  });

  it("verify.ts contains isNaN check", () => {
    expect(verifySrc).toContain("isNaN");
    expect(verifySrc).toContain("getTime()");
  });

  it("verification with NULL expiry is rejected (simulation)", () => {
    function checkExpiry(rawExp: string | null | undefined): "valid" | "invalid" {
      if (!rawExp) return "invalid";
      const exp = new Date(rawExp);
      if (isNaN(exp.getTime()) || exp < new Date()) return "invalid";
      return "valid";
    }

    expect(checkExpiry(null)).toBe("invalid");
    expect(checkExpiry(undefined)).toBe("invalid");
    expect(checkExpiry("not-a-date")).toBe("invalid");
    expect(checkExpiry("2020-01-01T00:00:00Z")).toBe("invalid"); // past date
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

  it("sessions.ts defines UUID_REGEX constant", () => {
    expect(sessionsSrc).toContain("UUID_REGEX");
  });

  it("DELETE /:id endpoint performs UUID validation", () => {
    const deleteIdx = sessionsSrc.indexOf("server.delete");
    const deleteSlice = sessionsSrc.slice(deleteIdx, deleteIdx + 900);
    expect(deleteSlice).toContain("UUID_REGEX");
    expect(deleteSlice).toContain("400");
  });

  it("DELETE ?user_id endpoint performs UUID validation", () => {
    // Second delete handler also has UUID check
    const firstDelete = sessionsSrc.indexOf("UUID_REGEX");
    const secondDelete = sessionsSrc.indexOf("UUID_REGEX", firstDelete + 1);
    expect(secondDelete).toBeGreaterThan(-1);
  });

  it("UUID regex format works correctly", () => {
    const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    // Valid UUIDs
    expect(UUID_REGEX.test("550e8400-e29b-41d4-a716-446655440000")).toBe(true);
    expect(UUID_REGEX.test("6ba7b810-9dad-11d1-80b4-00c04fd430c8")).toBe(true);
    expect(UUID_REGEX.test("550E8400-E29B-41D4-A716-446655440000")).toBe(true); // uppercase

    // Invalid values
    expect(UUID_REGEX.test("not-a-uuid")).toBe(false);
    expect(UUID_REGEX.test("sess-1")).toBe(false);
    expect(UUID_REGEX.test("user-uuid-1")).toBe(false);
    expect(UUID_REGEX.test("'; DROP TABLE sessions; --")).toBe(false);
    expect(UUID_REGEX.test("")).toBe(false);
    expect(UUID_REGEX.test("550e8400-e29b-41d4-a716")).toBe(false); // missing segment
  });

  it("::uuid cast is used (type-safe DB query)", () => {
    expect(sessionsSrc).toContain("::uuid");
  });
});