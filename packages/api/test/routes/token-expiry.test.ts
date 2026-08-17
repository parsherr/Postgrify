/**
 * Issue #10 Fix — POST /auth/token expiresIn parameter
 *
 * token.ts body: { database, secret, scope?, expiresIn? }
 * expiresIn: optional, default "24h", max 168h (7 days)
 * Format: "30s", "15m", "1h", "7d", etc.
 *
 * This test verifies that a token can be signed with a custom expiresIn value.
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

  // Import and register the token route separately
  const { tokenRoute } = await import("../../src/routes/auth/token.js");
  await app.register(tokenRoute);
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe("Issue #10 — POST /auth/token expiresIn parameter", () => {
  it("should produce a token without expiresIn (default 24h)", async () => {
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

  it("should produce a token with expiresIn=1h", async () => {
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

  it("should produce a token with expiresIn=30m", async () => {
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

  it("expiresIn=7d (max 168h) should be accepted", async () => {
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

  it("expiresIn=8d (> 168h) should be rejected (400)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/token",
      payload: {
        database: "mydb",
        secret: TEST_ADMIN_SECRET,
        expiresIn: "8d", // 192h > 168h max limit
      },
    });

    expect(res.statusCode).toBe(400);
  });

  it("expiresIn with an invalid format should be rejected (400)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/token",
      payload: {
        database: "mydb",
        secret: TEST_ADMIN_SECRET,
        expiresIn: "forever", // invalid format
      },
    });

    expect(res.statusCode).toBe(400);
  });

  it("should return 401 with the wrong secret", async () => {
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