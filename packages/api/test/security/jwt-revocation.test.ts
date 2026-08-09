/**
 * SEC-4: JWT JTI Blacklist (token revocation) testleri.
 *
 * Admin token'lar JTI (JWT ID) ile imzalanır.
 * Logout sonrası JTI kara listeye eklenerek token geçersiz kılınır.
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

  it("boş blacklist has() false döner", async () => {
    expect(await blacklist.has("some-jti")).toBe(false);
  });

  it("eklenen JTI has() ile bulunur", async () => {
    await blacklist.add("jti-123", 3600);
    expect(await blacklist.has("jti-123")).toBe(true);
  });

  it("farklı JTI has() ile bulunamaz", async () => {
    await blacklist.add("jti-abc", 3600);
    expect(await blacklist.has("jti-xyz")).toBe(false);
  });

  it("birden fazla JTI eklenebilir", async () => {
    await blacklist.add("jti-1", 3600);
    await blacklist.add("jti-2", 3600);
    await blacklist.add("jti-3", 3600);
    expect(await blacklist.has("jti-1")).toBe(true);
    expect(await blacklist.has("jti-2")).toBe(true);
    expect(await blacklist.has("jti-3")).toBe(true);
  });
});

describe("SEC-4: JtiBlacklist Redis backend", () => {
  it("Redis client bağlandığında Redis üzerinden kontrol yapar", async () => {
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

  it("Redis'te olmayan JTI has() false döner", async () => {
    const mockRedis = {
      set: vi.fn(),
      get: vi.fn().mockResolvedValue(null),
    };

    const blacklist = new JtiBlacklist();
    blacklist.setRedis(mockRedis);

    expect(await blacklist.has("not-in-redis")).toBe(false);
  });
});

describe("SEC-4: JwtService JTI entegrasyonu", () => {
  it("signAdminToken JTI içerir", async () => {
    const svc = new JwtService(TEST_JWT_SECRET);
    const token = await svc.signAdminToken("1h", "admin@example.com");

    const parts = token.split(".");
    expect(parts).toHaveLength(3);
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString());
    expect(payload.jti).toBeDefined();
    expect(typeof payload.jti).toBe("string");
    expect(payload.jti.length).toBeGreaterThan(10);
  });

  it("farklı admin token'lar farklı JTI içerir", async () => {
    const svc = new JwtService(TEST_JWT_SECRET);
    const t1 = await svc.signAdminToken("1h");
    const t2 = await svc.signAdminToken("1h");

    const jti1 = JSON.parse(Buffer.from(t1.split(".")[1], "base64url").toString()).jti;
    const jti2 = JSON.parse(Buffer.from(t2.split(".")[1], "base64url").toString()).jti;

    expect(jti1).not.toBe(jti2);
  });

  it("blacklist'e eklenmiş JTI olan token verifyAdminOrDb null döner", async () => {
    const svc = new JwtService(TEST_JWT_SECRET);

    const token = await svc.signAdminToken("1h");
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
    const jti = payload.jti as string;
    expect(jti).toBeDefined();

    // Global blacklist'e ekle
    await jtiBlacklist.add(jti, 3600);

    // Blacklist'e alındıktan sonra verify null döner
    const result = await svc.verifyAdminOrDb(token);
    expect(result).toBeNull();
  });

  it("JTI olmayan token (DB token) blacklist kontrolünü atlar", async () => {
    const svc = new JwtService(TEST_JWT_SECRET);
    // signDbToken JTI içermez
    const token = await svc.signDbToken("mydb", ["read"], "1h");
    const result = await svc.verifyAdminOrDb(token);
    // JTI yoksa blacklist'e bakmaz, token geçerli
    expect(result).not.toBeNull();
  });
});

describe("SEC-4: jwtService.ts kod kontrolü", () => {
  it("signAdminToken'da setJti() çağrılıyor", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const { dirname, join } = await import("node:path");

    const __dirname = dirname(fileURLToPath(import.meta.url));
    const svcPath = join(__dirname, "../../src/services/jwtService.ts");
    const content = readFileSync(svcPath, "utf-8");

    expect(content).toMatch(/setJti/);
    expect(content).toMatch(/randomUUID/);
  });

  it("verifyAdminOrDb JTI blacklist kontrolü içeriyor", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const { dirname, join } = await import("node:path");

    const __dirname = dirname(fileURLToPath(import.meta.url));
    const svcPath = join(__dirname, "../../src/services/jwtService.ts");
    const content = readFileSync(svcPath, "utf-8");

    expect(content).toMatch(/jtiBlacklist/);
    expect(content).toMatch(/jtiBlacklist\.has/);
  });

  it("JtiBlacklist export edilmiş", async () => {
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