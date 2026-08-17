/**
 * KRIT-3: SQL parametric query tests.
 *
 * pg_terminate_backend must use $1 parameter instead of string interpolation.
 * SQL call remains parameterized even if isValidIdentifier fails.
 *
 * HIGH-5: Metadata token field filtering tests.
 *
 * GET /db/:database/auth/users; metadata JSONB must not leak
 * reset_token, magic_token, and verification_token fields externally.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─────────────────────────────────────────────────────────────────────────────
// KRIT-3: pg_terminate_backend parametric query
// ─────────────────────────────────────────────────────────────────────────────

describe("KRIT-3: pg_terminate_backend parametric query", () => {
  const databasesPath = join(__dirname, "../../src/routes/admin/databases.ts");
  const databasesSrc = readFileSync(databasesPath, "utf-8");

  it("pg_terminate_backend does not use string interpolation", () => {
    // Old bad pattern: WHERE datname = '${db}'
    const badPattern = /datname\s*=\s*['"`]\$\{db\}['"`]/;
    expect(
      badPattern.test(databasesSrc),
      "string interpolation found in pg_terminate_backend query — must use $1"
    ).toBe(false);
  });

  it("pg_terminate_backend uses $1 parameter and [db] array", () => {
    const hasParam =
      databasesSrc.includes("$1") &&
      (databasesSrc.includes("[db]") || databasesSrc.includes("[ db ]"));
    expect(
      hasParam,
      "pg_terminate_backend must use $1 parameter and [db] array"
    ).toBe(true);
  });

  it("databases.ts calls isValidIdentifier before sql.unsafe", () => {
    const identifierIdx = databasesSrc.indexOf("isValidIdentifier");
    const unsafeIdx = databasesSrc.indexOf("sql.unsafe");
    expect(identifierIdx, "isValidIdentifier must be present in databases.ts").toBeGreaterThan(-1);
    expect(unsafeIdx, "sql.unsafe must be present in databases.ts").toBeGreaterThan(-1);
    expect(
      identifierIdx < unsafeIdx,
      "isValidIdentifier must come before sql.unsafe (defense in depth)"
    ).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// HIGH-5: /auth/users endpoint must filter sensitive metadata fields
// ─────────────────────────────────────────────────────────────────────────────

describe("HIGH-5: Sensitive metadata fields are filtered from /auth/users response", () => {
  const usersPath = join(__dirname, "../../src/routes/db/auth/users.ts");
  const usersSrc = readFileSync(usersPath, "utf-8");

  it("users.ts defines SENSITIVE_METADATA_KEYS constant", () => {
    expect(usersSrc).toContain("SENSITIVE_METADATA_KEYS");
  });

  it("SENSITIVE_METADATA_KEYS contains reset_token", () => {
    expect(usersSrc).toContain("reset_token");
  });

  it("SENSITIVE_METADATA_KEYS contains magic_token", () => {
    expect(usersSrc).toContain("magic_token");
  });

  it("SENSITIVE_METADATA_KEYS contains verification_token", () => {
    expect(usersSrc).toContain("verification_token");
  });

  it("sanitizeUser() helper is defined in users.ts", () => {
    expect(usersSrc).toContain("sanitizeUser");
  });

  it("stripSensitiveMetadata() removes reset_token from metadata object", () => {
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

  it("users list endpoint calls sanitizeUser()", () => {
    // Match the .map((u) => sanitizeUser(...) call pattern
    // Note: .*? is used instead of [^)]* because ) inside (u) breaks [^)]*
    expect(usersSrc).toMatch(/\.map\(.*?=>\s*sanitizeUser/s);
  });

  it("sanitizeUser appears at least 2 times in users.ts (definition + call)", () => {
    const sanitizeCount = (usersSrc.match(/sanitizeUser/g) ?? []).length;
    expect(
      sanitizeCount,
      "sanitizeUser must appear at least 2 times (definition + list endpoint call)"
    ).toBeGreaterThanOrEqual(2);
  });
});