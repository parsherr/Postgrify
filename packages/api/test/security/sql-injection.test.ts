/**
 * KRIT-3: SQL injection koruma testleri.
 *
 * identifier.ts'deki isValidIdentifier fonksiyonu ve
 * databases.ts'deki parametrik query kullanımı test edilir.
 */

import { describe, it, expect } from "vitest";
import { isValidIdentifier, assertIdentifier } from "../../src/utils/identifier.js";

describe("KRIT-3: isValidIdentifier SQL injection koruması", () => {
  // Geçerli identifier'lar
  it.each([
    "users",
    "my_table",
    "Table123",
    "_private",
    "a",
    "column_name_63_chars_long_valid_identifier_xxxxxxxxxxxxxxxxxx",
  ])("geçerli identifier kabul edilir: %s", (name) => {
    expect(isValidIdentifier(name)).toBe(true);
  });

  // SQL injection girişimleri
  it.each([
    ["boş string", ""],
    ["tek tırnak", "'users'"],
    ["çift tırnak", '"users"'],
    ["noktalı virgül", "users; DROP TABLE users"],
    ["yorum", "users--comment"],
    ["blok yorum", "users /* comment */"],
    ["space içeren", "user name"],
    ["SQL OR injection", "1 OR 1=1"],
    ["UNION injection", "users UNION SELECT"],
    ["null byte", "users\0"],
    ["newline", "users\ntable"],
    ["tab", "users\ttable"],
    ["backslash", "users\\table"],
    ["dolar işareti", "$users"],
    ["parantez", "users()"],
    ["virgül", "users,posts"],
    ["eşittir", "users=1"],
    ["büyüktür", "users>1"],
    ["küçüktür", "users<1"],
  ])("injection girişimi reddedilir: %s", (_label, name) => {
    expect(isValidIdentifier(name)).toBe(false);
  });

  // Reserved keyword'ler
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
  ])("SQL reserved keyword reddedilir: %s", (name) => {
    expect(isValidIdentifier(name)).toBe(false);
  });

  it("63 karakter sınırını aşan identifier reddedilir", () => {
    const tooLong = "a".repeat(64);
    expect(isValidIdentifier(tooLong)).toBe(false);
  });

  it("63 karakter tam sınır kabul edilir", () => {
    const maxLen = "a".repeat(63);
    expect(isValidIdentifier(maxLen)).toBe(true);
  });

  it("rakam ile başlayan identifier reddedilir", () => {
    expect(isValidIdentifier("1users")).toBe(false);
    expect(isValidIdentifier("123table")).toBe(false);
  });
});

describe("KRIT-3: assertIdentifier hata fırlatma", () => {
  it("geçerli identifier'da hata fırlatmaz", () => {
    expect(() => assertIdentifier("users", "table")).not.toThrow();
  });

  it("geçersiz identifier'da hata fırlatır", () => {
    expect(() => assertIdentifier("'; DROP TABLE users; --", "table")).toThrow(
      /Invalid table name/
    );
  });

  it("hata mesajı geçersiz değeri içerir", () => {
    const badName = "bad;name";
    expect(() => assertIdentifier(badName, "column")).toThrow(badName);
  });
});

describe("KRIT-3: pg_terminate_backend parametrik query doğrulama", () => {
  it("databases.ts'de string interpolasyon kullanılmıyor", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const { dirname, join } = await import("node:path");

    const __dirname = dirname(fileURLToPath(import.meta.url));
    const filePath = join(__dirname, "../../src/routes/admin/databases.ts");
    const content = readFileSync(filePath, "utf-8");

    // Eski güvensiz interpolasyon pattern'ı bulunmamalı
    // datname = '${db}' gibi bir şey olmamalı
    expect(content).not.toMatch(/datname\s*=\s*['"]?\$\{[^}]+\}/);

    // $1 parametrik kullanımı bulunmalı
    expect(content).toMatch(/datname\s*=\s*\$1/);
  });
});