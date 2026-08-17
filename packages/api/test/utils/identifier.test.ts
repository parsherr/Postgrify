/**
 * Identifier validation tests.
 */

import { describe, it, expect } from "vitest";
import {
  isValidIdentifier,
  assertIdentifier,
} from "../../src/utils/identifier.js";

describe("isValidIdentifier", () => {
  it("returns true for valid names", () => {
    expect(isValidIdentifier("users")).toBe(true);
    expect(isValidIdentifier("my_table")).toBe(true);
    expect(isValidIdentifier("_private")).toBe(true);
    expect(isValidIdentifier("table123")).toBe(true);
    expect(isValidIdentifier("CamelCase")).toBe(true);
  });

  it("rejects a name starting with a digit", () => {
    expect(isValidIdentifier("1table")).toBe(false);
  });

  it("rejects a name containing a hyphen (-)", () => {
    expect(isValidIdentifier("my-table")).toBe(false);
  });

  it("rejects a name containing a dot (.)", () => {
    expect(isValidIdentifier("schema.table")).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(isValidIdentifier("")).toBe(false);
  });

  it("rejects a name longer than 63 characters", () => {
    expect(isValidIdentifier("a".repeat(64))).toBe(false);
    expect(isValidIdentifier("a".repeat(63))).toBe(true);
  });

  it("rejects SQL reserved keywords", () => {
    expect(isValidIdentifier("select")).toBe(false);
    expect(isValidIdentifier("DROP")).toBe(false);
    expect(isValidIdentifier("delete")).toBe(false);
    expect(isValidIdentifier("insert")).toBe(false);
  });

  it("rejects a name containing a space", () => {
    expect(isValidIdentifier("my table")).toBe(false);
  });
});

describe("assertIdentifier", () => {
  it("does not throw for a valid name", () => {
    expect(() => assertIdentifier("users", "table")).not.toThrow();
  });

  it("throws a descriptive error for an invalid name", () => {
    expect(() => assertIdentifier("1bad", "column")).toThrow(/Invalid column/);
  });
});