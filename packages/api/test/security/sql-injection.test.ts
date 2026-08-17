/**
 * KRIT-3: SQL injection protection tests.
 *
 * Tests the isValidIdentifier function in identifier.ts and
 * parametric query usage in databases.ts.
 */

import { describe, it, expect } from "vitest";
import { isValidIdentifier, assertIdentifier } from "../../src/utils/identifier.js";

describe("KRIT-3: isValidIdentifier SQL injection protection", () => {
  // Valid identifiers
  it.each([
    "users",
    "my_table",
    "Table123",
    "_private",
    "a",
    "column_name_63_chars_long_valid_identifier_xxxxxxxxxxxxxxxxxx",
  ])("valid identifier is accepted: %s", (name) => {
    expect(isValidIdentifier(name)).toBe(true);
  });

  // SQL injection attempts
  it.each([
    ["empty string", ""],
    ["single quote", "'users'"],
    ["double quote", '"users"'],
    ["semicolon", "users; DROP TABLE users"],
    ["comment", "users--comment"],
    ["block comment", "users /* comment */"],
    ["contains space", "user name"],
    ["SQL OR injection", "1 OR 1=1"],
    ["UNION injection", "users UNION SELECT"],
    ["null byte", "users\0"],
    ["newline", "users\ntable"],
    ["tab", "users\ttable"],
    ["backslash", "users\\table"],
    ["dollar sign", "$users"],
    ["parentheses", "users()"],
    ["comma", "users,posts"],
    ["equals sign", "users=1"],
    ["greater than", "users>1"],
    ["less than", "users<1"],
  ])("injection attempt is rejected: %s", (_label, name) => {
    expect(isValidIdentifier(name)).toBe(false);
  });

  // Reserved keywords
  it.each([
    "select",
    "SELECT",
    "insert",
    "INSERT",
    "update",
    "UPDATE",
    "delete",
    "DELETE",
    "drop",
    "DROP",
    "create",
    "CREATE",
    "alter",
    "ALTER",
    "truncate",
    "TRUNCATE",
    "grant",
    "GRANT",
    "revoke",
    "REVOKE",
  ])("SQL reserved keyword is rejected: %s", (name) => {
    expect(isValidIdentifier(name)).toBe(false);
  });

  it("identifier exceeding 63 character limit is rejected", () => {
    const tooLong = "a".repeat(64);
    expect(isValidIdentifier(tooLong)).toBe(false);
  });

  it("identifier at exact 63 character limit is accepted", () => {
    const maxLen = "a".repeat(63);
    expect(isValidIdentifier(maxLen)).toBe(true);
  });

  it("identifier starting with a digit is rejected", () => {
    expect(isValidIdentifier("1users")).toBe(false);
    expect(isValidIdentifier("123table")).toBe(false);
  });
});

describe("KRIT-3: assertIdentifier throws on invalid input", () => {
  it("does not throw on valid identifier", () => {
    expect(() => assertIdentifier("users", "table")).not.toThrow();
  });

  it("throws on invalid identifier", () => {
    expect(() => assertIdentifier("'; DROP TABLE users; --", "table")).toThrow(
      /Invalid table name/
    );
  });

  it("error message contains the invalid value", () => {
    const badName = "bad;name";
    expect(() => assertIdentifier(badName, "column")).toThrow(badName);
  });
});

describe("KRIT-3: pg_terminate_backend parametric query verification", () => {
  it("databases.ts does not use string interpolation", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const { dirname, join } = await import("node:path");

    const __dirname = dirname(fileURLToPath(import.meta.url));
    const filePath = join(__dirname, "../../src/routes/admin/databases.ts");
    const content = readFileSync(filePath, "utf-8");

    // Old unsafe interpolation pattern must not be present
    // Nothing like datname = '${db}' should exist
    expect(content).not.toMatch(/datname\s*=\s*['"]?\$\{[^}]+\}/);

    // $1 parametric usage must be present
    expect(content).toMatch(/datname\s*=\s*\$1/);
  });
});