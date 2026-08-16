/**
 * E-12 array / range parser unit tests — thorough, not smoke-only.
 */

import { describe, it, expect } from "vitest";
import {
  parseBraceArray,
  parseRangeLiteral,
  buildArrayRangeClause,
  isArrayRangeOp,
} from "../../src/services/queryArrayRange.js";
import { parseWhereConditions } from "../../src/services/queryBuilder.js";

describe("parseBraceArray", () => {
  it("parses simple string elements", () => {
    expect(parseBraceArray("{coding,go}")).toEqual(["coding", "go"]);
  });

  it("parses empty array", () => {
    expect(parseBraceArray("{}")).toEqual([]);
  });

  it("coerces all-integer elements to numbers", () => {
    expect(parseBraceArray("{1,2,3}")).toEqual([1, 2, 3]);
  });

  it("coerces all-float elements to numbers", () => {
    expect(parseBraceArray("{1.5,2.0}")).toEqual([1.5, 2.0]);
  });

  it("keeps mixed int/string as strings", () => {
    expect(parseBraceArray("{1,a}")).toEqual(["1", "a"]);
  });

  it("supports double-quoted element with comma", () => {
    expect(parseBraceArray('{a,"b,c",d}')).toEqual(["a", "b,c", "d"]);
  });

  it("supports escaped quote inside quotes", () => {
    expect(parseBraceArray('{"a\\"b"}')).toEqual(['a"b']);
  });

  it("trims whitespace around unquoted elements", () => {
    expect(parseBraceArray("{ a , b }")).toEqual(["a", "b"]);
  });

  it("rejects missing braces", () => {
    expect(() => parseBraceArray("a,b")).toThrow(/expects \{/);
  });

  it("rejects empty element", () => {
    expect(() => parseBraceArray("{a,,b}")).toThrow(/Empty array element/);
  });

  it("rejects SQL-looking unquoted element", () => {
    expect(() => parseBraceArray("{a;drop}")).toThrow(/Invalid array element/);
  });

  it("rejects comment markers in unquoted element", () => {
    expect(() => parseBraceArray("{a--b}")).toThrow(/Invalid array element/);
  });

  it("rejects unterminated quote", () => {
    expect(() => parseBraceArray('{"abc}')).toThrow(/Unterminated/);
  });
});

describe("parseRangeLiteral", () => {
  it("parses closed numeric range → numrange", () => {
    expect(parseRangeLiteral("[0,100]")).toEqual({
      literal: "[0,100]",
      cast: "numrange",
    });
  });

  it("parses open numeric range", () => {
    expect(parseRangeLiteral("(0,100)")).toEqual({
      literal: "(0,100)",
      cast: "numrange",
    });
  });

  it("parses date range → daterange", () => {
    expect(parseRangeLiteral("[2026-01-01,2026-06-01]")).toEqual({
      literal: "[2026-01-01,2026-06-01]",
      cast: "daterange",
    });
  });

  it("parses timestamp range → tsrange", () => {
    expect(parseRangeLiteral("[2026-01-01 00:00,2026-01-02 12:00]")).toEqual({
      literal: "[2026-01-01 00:00,2026-01-02 12:00]",
      cast: "tsrange",
    });
  });

  it("allows infinity bounds with numeric cast", () => {
    expect(parseRangeLiteral("[0,infinity]").cast).toBe("numrange");
  });

  it("rejects semicolon injection", () => {
    expect(() => parseRangeLiteral("[0,1];drop")).toThrow();
  });

  it("rejects two commas", () => {
    expect(() => parseRangeLiteral("[0,1,2]")).toThrow(/exactly one comma/);
  });

  it("rejects empty bound", () => {
    expect(() => parseRangeLiteral("[,100]")).toThrow(/Empty range bound/);
  });

  it("rejects non-range shape", () => {
    expect(() => parseRangeLiteral("{0,100}")).toThrow(/expects/);
  });

  it("rejects mixed date/number bounds", () => {
    expect(() => parseRangeLiteral("[2026-01-01,100]")).toThrow(/Mixed|Invalid/);
  });
});

describe("buildArrayRangeClause", () => {
  it("cs with array → @> $1", () => {
    const c = buildArrayRangeClause('"tags"', "cs", "{coding,go}", 0);
    expect(c.sql).toBe('"tags" @> $1');
    expect(c.values).toEqual([["coding", "go"]]);
  });

  it("cd with int array", () => {
    const c = buildArrayRangeClause('"ids"', "cd", "{1,2}", 2);
    expect(c.sql).toBe('"ids" <@ $3');
    expect(c.values).toEqual([[1, 2]]);
  });

  it("ov with date range", () => {
    const c = buildArrayRangeClause(
      '"schedule"',
      "ov",
      "[2026-01-01,2026-06-01]",
      0
    );
    expect(c.sql).toBe('"schedule" && $1::daterange');
    expect(c.values).toEqual(["[2026-01-01,2026-06-01]"]);
  });

  it("sl with numrange", () => {
    const c = buildArrayRangeClause('"price"', "sl", "(0,100)", 0);
    expect(c.sql).toBe('"price" << $1::numrange');
  });

  it("adj uses -|- operator", () => {
    const c = buildArrayRangeClause('"r"', "adj", "[10,20]", 0);
    expect(c.sql).toBe('"r" -|- $1::numrange');
  });

  it("nxl / nxr", () => {
    expect(buildArrayRangeClause('"r"', "nxl", "[1,10]", 0).sql).toContain("&>");
    expect(buildArrayRangeClause('"r"', "nxr", "[1,10]", 0).sql).toContain("&<");
  });

  it("cs rejects non-array non-range value", () => {
    expect(() => buildArrayRangeClause('"t"', "cs", "coding", 0)).toThrow(
      /expects/
    );
  });
});

describe("isArrayRangeOp", () => {
  it("recognizes all E-12 ops", () => {
    for (const op of ["cs", "cd", "ov", "sl", "sr", "nxl", "nxr", "adj"]) {
      expect(isArrayRangeOp(op)).toBe(true);
    }
    expect(isArrayRangeOp("eq")).toBe(false);
  });
});

describe("parseWhereConditions — E-12 integration", () => {
  it("tags.cs.{coding,go}", () => {
    const { sql, values } = parseWhereConditions(["tags.cs.{coding,go}"]);
    expect(sql).toBe('WHERE "tags" @> $1');
    expect(values).toEqual([["coding", "go"]]);
  });

  it("ids.ov.{1,2} with AND", () => {
    const { sql, values } = parseWhereConditions([
      "active.eq.true",
      "ids.ov.{1,2}",
    ]);
    expect(sql).toBe('WHERE "active" = $1 AND "ids" && $2');
    expect(values).toEqual(["true", [1, 2]]);
  });

  it("price_range.sl.(0,100)", () => {
    const { sql, values } = parseWhereConditions(["price_range.sl.(0,100)"]);
    expect(sql).toBe('WHERE "price_range" << $1::numrange');
    expect(values).toEqual(["(0,100)"]);
  });

  it("rejects injection in array element via where", () => {
    expect(() =>
      parseWhereConditions(["tags.cs.{ok;drop table}"])
    ).toThrow(/Invalid array element/);
  });

  it("eq still works (regression)", () => {
    const { sql, values } = parseWhereConditions(["name.eq.alice"]);
    expect(sql).toBe('WHERE "name" = $1');
    expect(values).toEqual(["alice"]);
  });
});
