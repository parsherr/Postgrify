/**
 * Auth endpoint testleri.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { JwtService } from "../../src/services/jwtService.js";

const TEST_JWT_SECRET = "test-secret-must-be-at-least-32-characters";
const TEST_ADMIN_SECRET = "test-admin-secret-16ch";

// env değerlerini set et
vi.stubEnv("JWT_SECRET", TEST_JWT_SECRET);
vi.stubEnv("ADMIN_SECRET", TEST_ADMIN_SECRET);

let server: FastifyInstance;

beforeAll(async () => {
  server = Fastify({ logger: false });

  const { authRoutes } = await import("../../src/routes/auth/index.js");
  await server.register(authRoutes, { prefix: "/auth" });
  await server.ready();
});

afterAll(async () => {
  await server.close();
  vi.unstubAllEnvs();
});

describe("POST /auth/token/admin", () => {
  it("doğru secret ile admin JWT döner", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/auth/token/admin",
      payload: { adminSecret: TEST_ADMIN_SECRET },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(typeof body.token).toBe("string");
    expect(body.role).toBe("admin");

    // Token doğrula
    const jwtSvc = new JwtService(TEST_JWT_SECRET);
    const payload = await jwtSvc.verify(body.token);
    expect(payload?.role).toBe("admin");
  });

  it("yanlış secret ile 401 döner", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/auth/token/admin",
      payload: { adminSecret: "wrong-secret" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("body eksikken 400 döner", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/auth/token/admin",
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("POST /auth/token", () => {
  it("geçerli DB token döner (ADMIN_SECRET fallback)", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/auth/token",
      payload: {
        database: "project1",
        secret: TEST_ADMIN_SECRET,
        scope: ["read"],
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.database).toBe("project1");
    expect(body.scope).toEqual(["read"]);

    const jwtSvc = new JwtService(TEST_JWT_SECRET);
    const payload = await jwtSvc.verify(body.token);
    expect(payload?.sub).toBe("project1");
    expect(payload?.role).toBe("db");
  });

  it("geçersiz DB adı ile 400 döner", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/auth/token",
      payload: { database: "123invalid", secret: "any" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("yanlış secret ile 401 döner", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/auth/token",
      payload: { database: "project1", secret: "wrong" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("expiresIn '169h' ile 400 döner (max 168h aşıldı)", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/auth/token",
      payload: { database: "project1", secret: TEST_ADMIN_SECRET, expiresIn: "169h" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/168h/);
  });

  it("expiresIn '168h' ile 200 döner (sınırda geçmeli)", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/auth/token",
      payload: { database: "project1", secret: TEST_ADMIN_SECRET, expiresIn: "168h" },
    });
    expect(res.statusCode).toBe(200);
  });

  it("expiresIn '2d' ile 200 döner (48h, sınır dahilinde)", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/auth/token",
      payload: { database: "project1", secret: TEST_ADMIN_SECRET, expiresIn: "2d" },
    });
    expect(res.statusCode).toBe(200);
  });

  it("expiresIn 'geçersiz' format ile 400 döner", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/auth/token",
      payload: { database: "project1", secret: TEST_ADMIN_SECRET, expiresIn: "onehour" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/Invalid expiresIn/);
  });
});

describe("POST /auth/token/admin — expiresIn sınırları", () => {
  it("expiresIn '25h' ile 400 döner (max 24h aşıldı)", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/auth/token/admin",
      payload: { adminSecret: TEST_ADMIN_SECRET, expiresIn: "25h" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/24h/);
  });

  it("expiresIn '24h' ile 200 döner (sınırda geçmeli)", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/auth/token/admin",
      payload: { adminSecret: TEST_ADMIN_SECRET, expiresIn: "24h" },
    });
    expect(res.statusCode).toBe(200);
  });

  it("expiresIn 'abc' geçersiz format ile 400 döner", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/auth/token/admin",
      payload: { adminSecret: TEST_ADMIN_SECRET, expiresIn: "abc" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/Invalid expiresIn/);
  });

  it("yanlış admin secret timing-safe şekilde 401 döner", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/auth/token/admin",
      payload: { adminSecret: "completely-wrong-secret-123456" },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe("Invalid admin secret");
  });
});