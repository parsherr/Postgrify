/**
 * JwtService unit tests.
 * Real crypto operations are tested — no mocks.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { JwtService } from "../../src/services/jwtService.js";

const SECRET = "test-secret-must-be-at-least-32-characters";
let svc: JwtService;

beforeAll(() => {
  svc = new JwtService(SECRET);
});

describe("JwtService.signDbToken", () => {
  it("produces a valid DB token", async () => {
    const token = await svc.signDbToken("project1", ["read", "write"]);
    expect(typeof token).toBe("string");
    expect(token.split(".")).toHaveLength(3); // JWT format: header.payload.sig
  });

  it("returns the correct payload when verified", async () => {
    const token = await svc.signDbToken("project1", ["read", "write"]);
    const payload = await svc.verify(token);

    expect(payload).not.toBeNull();
    expect(payload?.sub).toBe("project1");
    expect(payload?.role).toBe("db");
    expect(payload?.scope).toEqual(["read", "write"]);
  });

  it("produces tokens with different scopes correctly", async () => {
    const token = await svc.signDbToken("db2", ["read", "delete", "schema"]);
    const payload = await svc.verify(token);
    expect(payload?.scope).toEqual(["read", "delete", "schema"]);
  });
});

describe("JwtService.signAdminToken", () => {
  it("produces an admin token", async () => {
    const token = await svc.signAdminToken();
    const payload = await svc.verify(token);

    expect(payload?.role).toBe("admin");
    expect(payload?.sub).toBeUndefined();
  });
});

describe("JwtService.verify", () => {
  it("returns null for an invalid token", async () => {
    const result = await svc.verify("not.a.jwt");
    expect(result).toBeNull();
  });

  it("returns null for a token signed with a different secret", async () => {
    const otherSvc = new JwtService("other-secret-must-be-at-least-32-chars!!");
    const token = await otherSvc.signDbToken("db", ["read"]);
    const result = await svc.verify(token);
    expect(result).toBeNull();
  });

  it("returns null for an expired token", async () => {
    // jose supports the "1s" format; wait 1s + 100ms buffer for expiry
    const token = await svc.signDbToken("db", ["read"], "1s");
    await new Promise((r) => setTimeout(r, 1100));
    const result = await svc.verify(token);
    expect(result).toBeNull();
  });
});