/**
 * E-23 CSV util unit tests.
 */

import { describe, it, expect } from "vitest";
import { rowsToCsv, wantsCsv } from "../../src/utils/csv.js";

describe("wantsCsv", () => {
  it("detects text/csv", () => {
    expect(wantsCsv("text/csv")).toBe(true);
    expect(wantsCsv("text/csv; charset=utf-8")).toBe(true);
    expect(wantsCsv("application/json, text/csv")).toBe(true);
  });

  it("rejects json / missing", () => {
    expect(wantsCsv(undefined)).toBe(false);
    expect(wantsCsv("application/json")).toBe(false);
    expect(wantsCsv("*/*")).toBe(false);
  });
});

describe("rowsToCsv", () => {
  it("header + rows", () => {
    const csv = rowsToCsv([
      { id: 1, name: "Ali", email: "ali@example.com" },
      { id: 2, name: "Veli", email: "veli@example.com" },
    ]);
    expect(csv).toBe(
      "id,name,email\n1,Ali,ali@example.com\n2,Veli,veli@example.com"
    );
  });

  it("escapes quotes commas newlines", () => {
    const csv = rowsToCsv([{ a: 'say "hi"', b: "x,y", c: "line1\nline2" }]);
    expect(csv).toBe(
      'a,b,c\n"say ""hi""","x,y","line1\nline2"'
    );
  });

  it("null/undefined → empty field", () => {
    expect(rowsToCsv([{ a: null, b: undefined, c: 1 }])).toBe("a,b,c\n,,1");
  });

  it("empty rows → empty string", () => {
    expect(rowsToCsv([])).toBe("");
  });

  it("empty rows with columns → header only", () => {
    expect(rowsToCsv([], ["id", "name"])).toBe("id,name");
  });

  it("objects become JSON (quoted when commas present)", () => {
    expect(rowsToCsv([{ meta: { x: 1 } }])).toBe('meta\n"{""x"":1}"');
  });
});
