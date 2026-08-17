/**
 * SessionService unit tests — no real Redis required.
 *
 * SessionService constructor:
 *   new SessionService(redisUrl: string | undefined, refreshTokenExpiry: string)
 *
 * When redisUrl is undefined the service operates in no-op mode:
 * create() returns null, get() returns null, revoke() is a no-op, etc.
 * This allows the tests to run without a Redis instance.
 */

import { describe, it, expect, vi } from "vitest";

// Mock the redis package so no real network connection is attempted.
vi.mock("redis", () => ({
  createClient: vi.fn(() => ({
    connect: vi.fn().mockResolvedValue(undefined),
    quit: vi.fn().mockResolvedValue(undefined),
    set: vi.fn().mockResolvedValue("OK"),
    get: vi.fn().mockResolvedValue(null),
    del: vi.fn().mockResolvedValue(1),
    keys: vi.fn().mockResolvedValue([]),
  })),
}));

/** Construct a SessionService with no Redis URL — safe no-op mode. */
async function makeSvc() {
  const { SessionService } = await import(
    "../../src/services/sessionService.js"
  );
  // redisUrl=undefined → no-op mode; "7d" is a valid refresh token expiry.
  return new SessionService(undefined, "7d");
}

describe("SessionService — create", () => {
  it("returns null in no-op mode (no Redis URL configured)", async () => {
    const svc = await makeSvc();
    const result = await svc.create("user@example.com");
    // Without Redis, create() returns null — refresh token is unavailable.
    expect(result).toBeNull();
  });
});

describe("SessionService — get", () => {
  it("returns null in no-op mode", async () => {
    const svc = await makeSvc();
    const result = await svc.get("any-token");
    expect(result).toBeNull();
  });
});

describe("SessionService — revoke", () => {
  it("resolves without error in no-op mode", async () => {
    const svc = await makeSvc();
    await expect(svc.revoke("any-token")).resolves.not.toThrow();
  });
});

describe("SessionService — listAll", () => {
  it("returns empty array in no-op mode", async () => {
    const svc = await makeSvc();
    const result = await svc.listAll();
    expect(result).toEqual([]);
  });
});

describe("SessionService — revokeAllByEmail", () => {
  it("resolves without error in no-op mode", async () => {
    const svc = await makeSvc();
    await expect(svc.revokeAllByEmail("user@example.com")).resolves.not.toThrow();
  });
});