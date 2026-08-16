/**
 * Unit tests for Content-Range helper (C-01 / E-01).
 */

import { describe, it, expect, vi } from "vitest";
import { setContentRange, parseRangeHeader } from "../../src/utils/contentRange.js";

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

  it("returns null for invalid", () => {
    expect(parseRangeHeader("bytes=0-19")).toBeNull();
    expect(parseRangeHeader(undefined)).toBeNull();
  });
});

// silence unused vi in case
void vi;
