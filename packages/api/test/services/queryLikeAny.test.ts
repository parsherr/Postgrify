/**
 * E-13 like(any|all) / ilike(any|all) — thorough unit tests.
 */

import { describe, it, expect } from "vitest";
import {
  parseBracePatterns,
  buildLikeAnyAllClause,
  matchLikeAnyAll,
} from "../../src/services/queryLikeAny.js";
import { parseWhereConditions } from "../../src/services/queryBuilder.js";

describe("parseBracePatterns", () => {
  it("maps * to %", () => {
    expect(parseBracePatterns("{Smith*,Jones*}")).toEqual([
      "Smith%",
      "Jones%",
    ]);
  });

  it("maps ? to _", () => {
    expect(parseBracePatterns("{A?C}")).toEqual(["A_C"]);
  });

  it("keeps explicit %", () => {
    expect(parseBracePatterns("{%premium%}")).toEqual(["%premium%"]);
  });

  it("supports quoted pattern with comma", () => {
    expect(parseBracePatterns('{a,"b,c*"}')).toEqual(["a", "b,c%"]);
  });

  it("rejects empty {}", () => {
    expect(() => parseBracePatterns("{}")).toThrow(/Empty/);
  });

  it("rejects missing braces", () => {
    expect(() => parseBracePatterns("Smith*")).toThrow(/expects/);
  });

  it("rejects SQL metacharacters", () => {
    expect(() => parseBracePatterns("{a;drop}")).toThrow(/Invalid like pattern/);
  });

  it("rejects comment markers", () => {
    expect(() => parseBracePatterns("{a--b}")).toThrow(/Invalid like pattern/);
  });

  it("rejects empty element", () => {
    expect(() => parseBracePatterns("{a,,b}")).toThrow(/Empty like pattern/);
  });
});

describe("matchLikeAnyAll", () => {
  it("parses like(any).{...}", () => {
    expect(matchLikeAnyAll("like(any).{A*,B*}")).toEqual({
      kind: "like",
      quantifier: "any",
      value: "{A*,B*}",
    });
  });

  it("parses ilike(all).{...}", () => {
    expect(matchLikeAnyAll("ilike(all).{*x*,*y*}")).toEqual({
      kind: "ilike",
      quantifier: "all",
      value: "{*x*,*y*}",
    });
  });

  it("does not match plain like.", () => {
    expect(matchLikeAnyAll("like.A%")).toBeNull();
  });
});

describe("buildLikeAnyAllClause", () => {
  it("like(any) → OR of LIKE", () => {
    const c = buildLikeAnyAllClause('"last_name"', "like", "any", "{Smith*,Jones*}", 0);
    expect(c.sql).toBe('("last_name" LIKE $1 OR "last_name" LIKE $2)');
    expect(c.values).toEqual(["Smith%", "Jones%"]);
  });

  it("ilike(all) → AND of ILIKE", () => {
    const c = buildLikeAnyAllClause('"name"', "ilike", "all", "{*premium*,*pro*}", 1);
    expect(c.sql).toBe('("name" ILIKE $2 AND "name" ILIKE $3)');
    expect(c.values).toEqual(["%premium%", "%pro%"]);
  });
});

describe("parseWhereConditions — E-13 integration", () => {
  it("last_name.like(any).{Smith*,Jones*}", () => {
    const { sql, values } = parseWhereConditions([
      "last_name.like(any).{Smith*,Jones*}",
    ]);
    expect(sql).toBe(
      'WHERE ("last_name" LIKE $1 OR "last_name" LIKE $2)'
    );
    expect(values).toEqual(["Smith%", "Jones%"]);
  });

  it("name.ilike(all).{*premium*,*pro*}", () => {
    const { sql, values } = parseWhereConditions([
      "name.ilike(all).{*premium*,*pro*}",
    ]);
    expect(sql).toBe('WHERE ("name" ILIKE $1 AND "name" ILIKE $2)');
    expect(values).toEqual(["%premium%", "%pro%"]);
  });

  it("plain like still works (regression)", () => {
    const { sql, values } = parseWhereConditions(["name.like.Ali%"]);
    expect(sql).toBe('WHERE "name" LIKE $1');
    expect(values).toEqual(["Ali%"]);
  });

  it("AND with eq", () => {
    const { sql, values } = parseWhereConditions([
      "active.eq.true",
      "name.like(any).{A*,B*}",
    ]);
    expect(sql).toBe(
      'WHERE "active" = $1 AND ("name" LIKE $2 OR "name" LIKE $3)'
    );
    expect(values).toEqual(["true", "A%", "B%"]);
  });

  it("rejects empty pattern list", () => {
    expect(() =>
      parseWhereConditions(["name.like(any).{}"])
    ).toThrow(/Empty/);
  });

  it("rejects injection pattern", () => {
    expect(() =>
      parseWhereConditions(["name.like(any).{ok;drop}"])
    ).toThrow(/Invalid like pattern/);
  });
});
