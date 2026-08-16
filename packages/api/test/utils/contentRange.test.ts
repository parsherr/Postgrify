/**
 * Unit tests for Content-Range helper (C-01 / E-01 / E-21).
 */

import { describe, it, expect, vi } from "vitest";
import {
  setContentRange,
  parseRangeHeader,
  resolveListWindow,
} from "../../src/utils/contentRange.js";

function mockReply() {
  const headers: Record<string, string> = {};
  return {
    headers,
    header(k: string, v: string) {
      headers[k.toLowerCase()] = v;
      return this;
    },
  };
}

describe("setContentRange", () => {
  it("sets start-end/* for a page without total", () => {
    const reply = mockReply();
    setContentRange(reply as never, 0, 2, null);
    expect(reply.headers["content-range"]).toBe("0-1/*");
    expect(reply.headers["range-unit"]).toBe("items");
  });

  it("sets start-end/total + X-Total-Count", () => {
    const reply = mockReply();
    setContentRange(reply as never, 10, 2, 42);
    expect(reply.headers["content-range"]).toBe("10-11/42");
    expect(reply.headers["x-total-count"]).toBe("42");
  });

  it("emptyStar → */total (HEAD limit=0)", () => {
    const reply = mockReply();
    setContentRange(reply as never, 0, 0, 42, { emptyStar: true });
    expect(reply.headers["content-range"]).toBe("*/42");
  });

  it("empty rows at offset 0 → */*", () => {
    const reply = mockReply();
    setContentRange(reply as never, 0, 0, null);
    expect(reply.headers["content-range"]).toBe("*/*");
  });
});

describe("parseRangeHeader", () => {
  it("parses items=0-19", () => {
    expect(parseRangeHeader("items=0-19")).toEqual({ offset: 0, limit: 20 });
  });

  it("parses bare 0-19", () => {
    expect(parseRangeHeader("0-19")).toEqual({ offset: 0, limit: 20 });
  });

  it("returns null for invalid", () => {
    expect(parseRangeHeader("bytes=0-19")).toBeNull();
    expect(parseRangeHeader("10-5")).toBeNull();
    expect(parseRangeHeader(undefined)).toBeNull();
  });
});

describe("resolveListWindow (E-21)", () => {
  it("Range overrides query limit/offset", () => {
    expect(
      resolveListWindow({ limit: 50, offset: 10 }, "0-19", "items")
    ).toEqual({ offset: 0, limit: 20, fromRange: true });
  });

  it("falls back to query when Range absent", () => {
    expect(
      resolveListWindow({ limit: 5, offset: 3 }, undefined, undefined)
    ).toEqual({
      offset: 3,
      limit: 5,
      fromRange: false,
    });
  });

  it("ignores Range when Range-Unit is not items", () => {
    expect(
      resolveListWindow({ limit: 10, offset: 0 }, "0-19", "bytes")
    ).toEqual({ offset: 0, limit: 10, fromRange: false });
  });

  it("caps Range page size at 1000", () => {
    expect(resolveListWindow({}, "0-5000", "items")).toEqual({
      offset: 0,
      limit: 1000,
      fromRange: true,
    });
  });
});

void vi;
