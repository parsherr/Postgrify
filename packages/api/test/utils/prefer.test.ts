/**
 * Unit tests for Prefer header parser (C-01 / E-05…E-08 foundation).
 */

import { describe, it, expect } from "vitest";
import { parsePrefer } from "../../src/utils/prefer.js";

describe("parsePrefer", () => {
  it("defaults to return=minimal and no count", () => {
    expect(parsePrefer(undefined)).toEqual({
      return: "minimal",
      count: null,
      resolution: null,
      missing: null,
      params: null,
    });
  });

  it("parses Prefer: params=single-object (E-10)", () => {
    expect(parsePrefer("params=single-object").params).toBe("single-object");
  });

  it("parses Prefer: count=exact", () => {
    expect(parsePrefer("count=exact").count).toBe("exact");
  });

  it("parses planned and estimated counts", () => {
    expect(parsePrefer("count=planned").count).toBe("planned");
    expect(parsePrefer("count=estimated").count).toBe("estimated");
  });

  it("parses multiple comma-separated preferences", () => {
    const p = parsePrefer("return=representation, count=exact");
    expect(p.return).toBe("representation");
    expect(p.count).toBe("exact");
  });

  it("is case-insensitive", () => {
    expect(parsePrefer("COUNT=EXACT").count).toBe("exact");
  });

  it("ignores unknown tokens", () => {
    expect(parsePrefer("foo=bar, count=exact").count).toBe("exact");
  });

  it("accepts array header values", () => {
    expect(parsePrefer(["count=exact", "return=minimal"]).count).toBe("exact");
  });
});
