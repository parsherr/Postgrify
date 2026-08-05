/**
 * JwtService unit testleri.
 * Gerçek crypto işlemleri test edilir — mock yok.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { JwtService } from "../../src/services/jwtService.js";

const SECRET = "test-secret-must-be-at-least-32-characters";
let svc: JwtService;

beforeAll(() => {
  svc = new JwtService(SECRET);
});

describe("JwtService.signDbToken", () => {
  it("geçerli DB token üretir", async () => {
    const token = await svc.signDbToken("project1", ["read", "write"]);
    expect(typeof token).toBe("string");
    expect(token.split(".")).toHaveLength(3); // JWT formatı: header.payload.sig
  });

  it("doğrulandığında doğru payload döner", async () => {
    const token = await svc.signDbToken("project1", ["read", "write"]);
    const payload = await svc.verify(token);

    expect(payload).not.toBeNull();
    expect(payload?.sub).toBe("project1");
    expect(payload?.role).toBe("db");
    expect(payload?.scope).toEqual(["read", "write"]);
  });

  it("farklı scope'larla token üretir", async () => {
    const token = await svc.signDbToken("db2", ["read", "delete", "schema"]);
    const payload = await svc.verify(token);
    expect(payload?.scope).toEqual(["read", "delete", "schema"]);
  });
});

describe("JwtService.signAdminToken", () => {
  it("admin token üretir", async () => {
    const token = await svc.signAdminToken();
    const payload = await svc.verify(token);

    expect(payload?.role).toBe("admin");
    expect(payload?.sub).toBeUndefined();
  });
});

describe("JwtService.verify", () => {
  it("geçersiz token için null döner", async () => {
    const result = await svc.verify("not.a.jwt");
    expect(result).toBeNull();
  });

  it("farklı secret ile imzalanmış token için null döner", async () => {
    const otherSvc = new JwtService("other-secret-must-be-at-least-32-chars!!");
    const token = await otherSvc.signDbToken("db", ["read"]);
    const result = await svc.verify(token);
    expect(result).toBeNull();
  });

  it("süresi dolmuş token için null döner", async () => {
    // jose "1s" formatını destekler; 1 saniye + 1100ms bekleme
    const token = await svc.signDbToken("db", ["read"], "1s");
    await new Promise((r) => setTimeout(r, 1100));
    const result = await svc.verify(token);
    expect(result).toBeNull();
  });
});