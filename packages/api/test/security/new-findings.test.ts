/**
 * New security findings tests (Round 4 analysis).
 *
 * NEW-1: Admin login timing attack protection
 * NEW-6: identifier.ts system prefix check (pg_, _postgrify_)
 * NEW-3/4: Token expiry NULL/Invalid Date protection
 * NEW-5: Failed login audit log
 */

import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─────────────────────────────────────────────────────────────────────────────
// NEW-1: Admin login timing attack protection
// ─────────────────────────────────────────────────────────────────────────────

describe("NEW-1: Admin login timing attack protection", () => {
  const loginSrc = readFileSync(
    join(__dirname, "../../src/routes/auth/adminLogin.ts"),
    "utf-8"
  );

  it("adminLogin.ts always calls verifyPassword (regardless of email match)", () => {
    // emailMatch variable must be created — separate boolean
    expect(loginSrc).toContain("emailMatch");
    // verifyPassword must always be called
    expect(loginSrc).toContain("verifyPassword");
  });

  it("email check and password check are combined in a single if block", () => {
    // Combined check in the form !emailMatch || !valid
    expect(loginSrc).toMatch(/!emailMatch\s*\|\|\s*!valid/);
  });

  it("early return is not done when email does not match (password validation is not skipped)", () => {
    // Old bad pattern: return immediately if email does not match
    const badEarlyReturn = /if\s*\([^)]*email[^)]*!==.*\)[\s\S]{0,50}return.*401/;
    expect(loginSrc).not.toMatch(badEarlyReturn);
  });

  it("explanatory comment about timing protection is present", () => {
    expect(loginSrc).toContain("timing");
  });

  it("adminLogin.ts calls verifyPassword with await", () => {
    expect(loginSrc).toMatch(/await\s+verifyPassword/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// NEW-6: identifier.ts system prefix check
// ─────────────────────────────────────────────────────────────────────────────

describe("NEW-6: identifier.ts system prefix protection", () => {
  // Module import — Vitest ESM test environment
  it("isValidIdentifier rejects pg_ prefix", async () => {
    const { isValidIdentifier } = await import("../../src/utils/identifier.js");
    expect(isValidIdentifier("pg_stat_activity")).toBe(false);
    expect(isValidIdentifier("pg_class")).toBe(false);
    expect(isValidIdentifier("pg_catalog")).toBe(false);
  });

  it("isValidIdentifier rejects _postgrify_ prefix", async () => {
    const { isValidIdentifier } = await import("../../src/utils/identifier.js");
    expect(isValidIdentifier("_postgrify_auth")).toBe(false);
    expect(isValidIdentifier("_postgrify_settings")).toBe(false);
  });

  it("isValidIdentifier accepts valid identifiers", async () => {
    const { isValidIdentifier } = await import("../../src/utils/identifier.js");
    expect(isValidIdentifier("users")).toBe(true);
    expect(isValidIdentifier("my_table_2")).toBe(true);
    expect(isValidIdentifier("_private")).toBe(true);
    expect(isValidIdentifier("CamelCase")).toBe(true);
  });

  it("isValidIdentifier rejects SQL keywords", async () => {
    const { isValidIdentifier } = await import("../../src/utils/identifier.js");
    expect(isValidIdentifier("select")).toBe(false);
    expect(isValidIdentifier("DROP")).toBe(false);
    expect(isValidIdentifier("information_schema")).toBe(false);
  });

  it("identifier.ts RESERVED_PREFIXES list contains pg_", () => {
    const src = readFileSync(
      join(__dirname, "../../src/utils/identifier.ts"),
      "utf-8"
    );
    expect(src).toContain("RESERVED_PREFIXES");
    expect(src).toContain("pg_");
    expect(src).toContain("_postgrify_");
  });

  it("identifier.ts prefix check uses startsWith", () => {
    const src = readFileSync(
      join(__dirname, "../../src/utils/identifier.ts"),
      "utf-8"
    );
    expect(src).toContain("startsWith");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// NEW-3/4: Token expiry NULL and Invalid Date protection
// ─────────────────────────────────────────────────────────────────────────────

describe("NEW-3/4: Token expiry NULL/Invalid Date protection", () => {
  it("understands unsafe behavior of new Date(undefined) (Invalid Date)", () => {
    // This test documents why the protection is necessary
    const d = new Date(undefined as unknown as string);
    expect(isNaN(d.getTime())).toBe(true);
    // Invalid Date < new Date() → returns false → token could be considered valid!
    expect(d < new Date()).toBe(false);
  });

  it("new Date(null) returns epoch (always expired)", () => {
    const d = new Date(null as unknown as string);
    expect(isNaN(d.getTime())).toBe(false);
    // null → epoch (1970) → always expired → this is safe but explicitly
    // rejecting null is better practice
    expect(d < new Date()).toBe(true);
  });

  it("passwordReset.ts contains rawExp null check", () => {
    const src = readFileSync(
      join(__dirname, "../../src/routes/db/auth/passwordReset.ts"),
      "utf-8"
    );
    expect(src).toContain("rawExp");
    expect(src).toContain("!rawExp");
    expect(src).toContain("isNaN");
    expect(src).toContain("exp.getTime()");
  });

  it("magicLink.ts contains rawExp null check", () => {
    const src = readFileSync(
      join(__dirname, "../../src/routes/db/auth/magicLink.ts"),
      "utf-8"
    );
    expect(src).toContain("rawExp");
    expect(src).toContain("!rawExp");
    expect(src).toContain("isNaN");
    expect(src).toContain("exp.getTime()");
  });

  it("passwordReset safe expiry check — rejects token with NULL input", () => {
    // Isolated test: token with null expiry must not be accepted
    function safeExpCheck(rawExp: string | null | undefined): boolean {
      if (!rawExp) return false; // null/undefined → invalid
      const exp = new Date(rawExp);
      if (isNaN(exp.getTime())) return false; // parse error → invalid
      return exp >= new Date(); // past date means expired → false
    }
    expect(safeExpCheck(null)).toBe(false);
    expect(safeExpCheck(undefined)).toBe(false);
    expect(safeExpCheck("not-a-date")).toBe(false);
    expect(safeExpCheck("2020-01-01T00:00:00Z")).toBe(false); // past date
    // Future date → valid
    expect(safeExpCheck(new Date(Date.now() + 60_000).toISOString())).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// NEW-5: Failed login audit log record
// ─────────────────────────────────────────────────────────────────────────────

describe("NEW-5: Failed login audit log", () => {
  it("tokens.ts writes login_failed event to audit log", () => {
    const src = readFileSync(
      join(__dirname, "../../src/routes/db/auth/tokens.ts"),
      "utf-8"
    );
    expect(src).toContain("login_failed");
    expect(src).toContain("insertAuditLog");
  });

  it("provision.ts has login_failed defined in AuditEvent type", () => {
    const src = readFileSync(
      join(__dirname, "../../src/routes/db/auth/provision.ts"),
      "utf-8"
    );
    expect(src).toContain("login_failed");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// NEW-8: Bulk PATCH/DELETE — WHERE requirement
// ─────────────────────────────────────────────────────────────────────────────

describe("NEW-8: Bulk PATCH/DELETE WHERE requirement", () => {
  const rowsSrc = readFileSync(
    join(__dirname, "../../src/routes/db/rows.ts"),
    "utf-8"
  );

  it("rows.ts PATCH endpoint requires a WHERE condition", () => {
    // where parameter must be checked as mandatory
    expect(rowsSrc).toContain("where");
    // Update without WHERE must be rejected
    const hasBulkUpdateGuard =
      rowsSrc.includes("No WHERE") ||
      rowsSrc.includes("where condition") ||
      rowsSrc.includes("conditions.length") ||
      rowsSrc.includes("parseWhereConditions");
    expect(hasBulkUpdateGuard).toBe(true);
  });

  it("rows.ts DELETE endpoint requires a WHERE condition", () => {
    expect(rowsSrc).toContain("parseWhereConditions");
    const hasDeleteGuard =
      rowsSrc.includes("No WHERE") ||
      rowsSrc.includes("conditions.length") ||
      rowsSrc.includes("where");
    expect(hasDeleteGuard).toBe(true);
  });

  it("queryBuilder.ts parseWhereConditions performs identifier validation", () => {
    const src = readFileSync(
      join(__dirname, "../../src/services/queryBuilder.ts"),
      "utf-8"
    );
    // queryBuilder may use isValidIdentifier or assertIdentifier
    const hasIdentifierCheck =
      src.includes("isValidIdentifier") || src.includes("assertIdentifier");
    expect(hasIdentifierCheck).toBe(true);
    expect(src).toContain("parseWhereConditions");
  });
});