/**
 * Identifier validasyon testleri.
 */

import { describe, it, expect } from "vitest";
import {
  isValidIdentifier,
  assertIdentifier,
} from "../../src/utils/identifier.js";

describe("isValidIdentifier", () => {
  it("geçerli isimler için true döner", () => {
    expect(isValidIdentifier("users")).toBe(true);
    expect(isValidIdentifier("my_table")).toBe(true);
    expect(isValidIdentifier("_private")).toBe(true);
    expect(isValidIdentifier("table123")).toBe(true);
    expect(isValidIdentifier("CamelCase")).toBe(true);
  });

  it("rakamla başlayan isim reddedilir", () => {
    expect(isValidIdentifier("1table")).toBe(false);
  });

  it("tire (-) içeren isim reddedilir", () => {
    expect(isValidIdentifier("my-table")).toBe(false);
  });

  it("nokta içeren isim reddedilir", () => {
    expect(isValidIdentifier("schema.table")).toBe(false);
  });

  it("boş string reddedilir", () => {
    expect(isValidIdentifier("")).toBe(false);
  });

  it("64 karakterden uzun isim reddedilir", () => {
    expect(isValidIdentifier("a".repeat(64))).toBe(false);
    expect(isValidIdentifier("a".repeat(63))).toBe(true);
  });

  it("SQL reserved keyword'ler reddedilir", () => {
    expect(isValidIdentifier("select")).toBe(false);
    expect(isValidIdentifier("DROP")).toBe(false);
    expect(isValidIdentifier("delete")).toBe(false);
    expect(isValidIdentifier("insert")).toBe(false);
  });

  it("boşluk içeren isim reddedilir", () => {
    expect(isValidIdentifier("my table")).toBe(false);
  });
});

describe("assertIdentifier", () => {
  it("geçerli isimde hata fırlatmaz", () => {
    expect(() => assertIdentifier("users", "table")).not.toThrow();
  });

  it("geçersiz isimde açıklayıcı hata fırlatır", () => {
    expect(() => assertIdentifier("1bad", "column")).toThrow(/Invalid column/);
  });
});