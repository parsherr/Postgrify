/**
 * SORUN #10 Fix — POST /auth/token expiresIn parametresi
 *
 * token.ts body: { database, secret, scope?, expiresIn? }
 * expiresIn: opsiyonel, varsayılan "24h", max 168h (7 gün)
 * Format: "30s", "15m", "1h", "7d" gibi
 *
 * Bu test tokenın özel expiresIn ile imzalanabildiğini doğrular.
 */

import { beforeAll, afterAll, describe, it, expect } from "vitest";
import Fastify from "fastify";
import { JwtService } from "../../src/services/jwtService.js";

const TEST_SECRET = "test-jwt-secret-32-chars-minimum!!";
const TEST_ADMIN_SECRET = "test-admin-secret-16ch";

let app: ReturnType<typeof Fastify>;

beforeAll(async () => {
  process.env.JWT_SECRET = TEST_SECRET;
  process.env.ADMIN_SECRET = TEST_ADMIN_SECRET;
  process.env.NODE_ENV = "test";
  process.env.LOG_LEVEL = "silent";

  app = Fastify({ logger: false });

  const jwtSvc = new JwtService(() => TEST_SECRET);
  app.decorate("jwtService", jwtSvc);
  app.decorate("authenticate", async () => {});
  app.decorate("authenticateAdmin", async () => {});
  app.decorate("poolManager", { getPool: () => ({}) });
  app.decorate("cache", { get: async () => null, set: async () => {}, del: async () => {} });
  app.decorate("settings", { get: async () => null });
  app.decorate("backupService", {});
  app.decorate("backupScheduler", {});

  // token route'u ayrı import edip kaydet
  const { tokenRoute } = await import("../../src/routes/auth/token.js");
  await app.register(tokenRoute);
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe("SORUN #10 — POST /auth/token expiresIn parametresi", () => {
  it("expiresIn olmadan token üretmeli (default 24h)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/token",
      payload: {
        database: "mydb",
        secret: TEST_ADMIN_SECRET,
        scope: ["read"],
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty("token");
    expect(typeof res.json().token).toBe("string");
  });

  it("expiresIn=1h ile token üretmeli", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/token",
      payload: {
        database: "mydb",
        secret: TEST_ADMIN_SECRET,
        scope: ["read", "write"],
        expiresIn: "1h",
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty("token");
  });

  it("expiresIn=30m ile token üretmeli", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/token",
      payload: {
        database: "mydb",
        secret: TEST_ADMIN_SECRET,
        expiresIn: "30m",
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty("token");
  });

  it("expiresIn=7d (max 168h) kabul edilmeli", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/token",
      payload: {
        database: "mydb",
        secret: TEST_ADMIN_SECRET,
        expiresIn: "7d",
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty("token");
  });

  it("expiresIn=8d (> 168h) reddedilmeli (400)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/token",
      payload: {
        database: "mydb",
        secret: TEST_ADMIN_SECRET,
        expiresIn: "8d", // 192h > 168h max
      },
    });

    expect(res.statusCode).toBe(400);
  });

  it("expiresIn geçersiz format reddedilmeli (400)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/token",
      payload: {
        database: "mydb",
        secret: TEST_ADMIN_SECRET,
        expiresIn: "forever", // geçersiz format
      },
    });

    expect(res.statusCode).toBe(400);
  });

  it("yanlış secret ile 401 dönmeli", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/token",
      payload: {
        database: "mydb",
        secret: "wrong-secret",
        expiresIn: "1h",
      },
    });

    expect(res.statusCode).toBe(401);
  });
});