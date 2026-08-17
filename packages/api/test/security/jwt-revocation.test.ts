/**
 * SEC-4: JWT JTI Blacklist (token revocation) tests.
 *
 * Admin tokens are signed with a JTI (JWT ID).
 * After logout, the JTI is added to the blacklist, invalidating the token.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { JwtService, JtiBlacklist, jtiBlacklist } from "../../src/services/jwtService.js";

const TEST_JWT_SECRET = "a-test-secret-that-is-at-least-32-chars-long-x";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("SEC-4: JtiBlacklist in-memory", () => {
  let blacklist: JtiBlacklist;

  beforeEach(() => {
    blacklist = new JtiBlacklist();
  });

  it("empty blacklist has() returns false", async () => {
    expect(await blacklist.has("some-jti")).toBe(false);
  });

  it("added JTI is found via has()", async () => {
    await blacklist.add("jti-123", 3600);
    expect(await blacklist.has("jti-123")).toBe(true);
  });

  it("different JTI is not found via has()", async () => {
    await blacklist.add("jti-abc", 3600);
    expect(await blacklist.has("jti-xyz")).toBe(false);
  });

  it("multiple JTIs can be added", async () => {
    await blacklist.add("jti-1", 3600);
    await blacklist.add("jti-2", 3600);
    await blacklist.add("jti-3", 3600);
    expect(await blacklist.has("jti-1")).toBe(true);
    expect(await blacklist.has("jti-2")).toBe(true);
    expect(await blacklist.has("jti-3")).toBe(true);
  });
});

describe("SEC-4: JtiBlacklist Redis backend", () => {
  it("checks via Redis when Redis client is connected", async () => {
    const store = new Map<string, string>();
    const mockRedis = {
      set: vi.fn().mockImplementation(async (key: string, _val: string, _opt: unknown) => {
        store.set(key, "1");
      }),
      get: vi.fn().mockImplementation(async (key: string) => store.get(key) ?? null),
    };

    const blacklist = new JtiBlacklist();
    blacklist.setRedis(mockRedis);

    await blacklist.add("redis-jti", 3600);
    expect(mockRedis.set).toHaveBeenCalledWith("jti:redis-jti", "1", { EX: 3600 });

    const found = await blacklist.has("redis-jti");
    expect(found).toBe(true);
    expect(mockRedis.get).toHaveBeenCalledWith("jti:redis-jti");
  });

  it("JTI not in Redis returns false from has()", async () => {
    const mockRedis = {
      set: vi.fn(),
      get: vi.fn().mockResolvedValue(null),
    };

    const blacklist = new JtiBlacklist();
    blacklist.setRedis(mockRedis);

    expect(await blacklist.has("not-in-redis")).toBe(false);
  });
});

describe("SEC-4: JwtService JTI integration", () => {
  it("signAdminToken includes JTI", async () => {
    const svc = new JwtService(TEST_JWT_SECRET);
    const token = await svc.signAdminToken("1h", "admin@example.com");

    const parts = token.split(".");
    expect(parts).toHaveLength(3);
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString());
    expect(payload.jti).toBeDefined();
    expect(typeof payload.jti).toBe("string");
    expect(payload.jti.length).toBeGreaterThan(10);
  });

  it("different admin tokens have different JTIs", async () => {
    const svc = new JwtService(TEST_JWT_SECRET);
    const t1 = await svc.signAdminToken("1h");
    const t2 = await svc.signAdminToken("1h");

    const jti1 = JSON.parse(Buffer.from(t1.split(".")[1], "base64url").toString()).jti;
    const jti2 = JSON.parse(Buffer.from(t2.split(".")[1], "base64url").toString()).jti;

    expect(jti1).not.toBe(jti2);
  });

  it("verifyAdminOrDb returns null for token whose JTI is in the blacklist", async () => {
    const svc = new JwtService(TEST_JWT_SECRET);

    const token = await svc.signAdminToken("1h");
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
    const jti = payload.jti as string;
    expect(jti).toBeDefined();

    // Add to global blacklist
    await jtiBlacklist.add(jti, 3600);

    // verify returns null after blacklisting
    const result = await svc.verifyAdminOrDb(token);
    expect(result).toBeNull();
  });

  it("token without JTI (DB token) skips blacklist check", async () => {
    const svc = new JwtService(TEST_JWT_SECRET);
    // signDbToken does not include JTI
    const token = await svc.signDbToken("mydb", ["read"], "1h");
    const result = await svc.verifyAdminOrDb(token);
    // Without JTI, blacklist is not consulted — token is valid
    expect(result).not.toBeNull();
  });
});

describe("SEC-4: jwtService.ts code check", () => {
  it("setJti() is called in signAdminToken", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const { dirname, join } = await import("node:path");

    const __dirname = dirname(fileURLToPath(import.meta.url));
    const svcPath = join(__dirname, "../../src/services/jwtService.ts");
    const content = readFileSync(svcPath, "utf-8");

    expect(content).toMatch(/setJti/);
    expect(content).toMatch(/randomUUID/);
  });

  it("verifyAdminOrDb contains JTI blacklist check", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const { dirname, join } = await import("node:path");

    const __dirname = dirname(fileURLToPath(import.meta.url));
    const svcPath = join(__dirname, "../../src/services/jwtService.ts");
    const content = readFileSync(svcPath, "utf-8");

    expect(content).toMatch(/jtiBlacklist/);
    expect(content).toMatch(/jtiBlacklist\.has/);
  });

  it("JtiBlacklist is exported", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const { dirname, join } = await import("node:path");

    const __dirname = dirname(fileURLToPath(import.meta.url));
    const svcPath = join(__dirname, "../../src/services/jwtService.ts");
    const content = readFileSync(svcPath, "utf-8");

    expect(content).toMatch(/export class JtiBlacklist/);
    expect(content).toMatch(/export const jtiBlacklist/);
  });
});
