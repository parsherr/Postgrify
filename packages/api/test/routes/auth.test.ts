/**
 * Auth endpoint tests.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { JwtService } from "../../src/services/jwtService.js";

const TEST_JWT_SECRET = "test-secret-must-be-at-least-32-characters";
const TEST_ADMIN_SECRET = "test-admin-secret-16ch";

// Set env values
vi.stubEnv("JWT_SECRET", TEST_JWT_SECRET);
vi.stubEnv("ADMIN_SECRET", TEST_ADMIN_SECRET);

let server: FastifyInstance;

beforeAll(async () => {
  server = Fastify({ logger: false });

  // authPlugin: provides server.jwtService + authenticate + authenticateAdmin decorators
  const { authPlugin } = await import("../../src/plugins/auth.js");
  await server.register(authPlugin);

  // sessionService mock: for logout/refresh endpoints
  server.decorate("sessionService", {
    isAvailable: false,
    create: async () => null,
    get: async () => null,
    revoke: async () => undefined,
    rotate: async () => null,
    listAll: async () => [],
    listByEmail: async () => [],
    revokeAllByEmail: async () => 0,
  });

  const { authRoutes } = await import("../../src/routes/auth/index.js");
  await server.register(authRoutes, { prefix: "/auth" });
  await server.ready();
});

afterAll(async () => {
  await server.close();
  vi.unstubAllEnvs();
});

describe("POST /auth/token/admin", () => {
  it("returns admin JWT with correct secret", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/auth/token/admin",
      payload: { adminSecret: TEST_ADMIN_SECRET },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(typeof body.token).toBe("string");
    expect(body.role).toBe("admin");

    // Verify token
    const jwtSvc = new JwtService(TEST_JWT_SECRET);
    const payload = await jwtSvc.verify(body.token);
    expect(payload?.role).toBe("admin");
  });

  it("returns 401 with wrong secret", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/auth/token/admin",
      payload: { adminSecret: "wrong-secret" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 400 when body is missing", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/auth/token/admin",
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("POST /auth/token", () => {
  it("returns valid DB token (ADMIN_SECRET fallback)", async () => {
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

  it("returns 400 with invalid DB name", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/auth/token",
      payload: { database: "123invalid", secret: "any" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 with wrong secret", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/auth/token",
      payload: { database: "project1", secret: "wrong" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 400 with expiresIn '169h' (max 168h exceeded)", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/auth/token",
      payload: { database: "project1", secret: TEST_ADMIN_SECRET, expiresIn: "169h" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/168h/);
  });

  it("returns 200 with expiresIn '168h' (exactly at the limit)", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/auth/token",
      payload: { database: "project1", secret: TEST_ADMIN_SECRET, expiresIn: "168h" },
    });
    expect(res.statusCode).toBe(200);
  });

  it("returns 200 with expiresIn '2d' (48h, within the limit)", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/auth/token",
      payload: { database: "project1", secret: TEST_ADMIN_SECRET, expiresIn: "2d" },
    });
    expect(res.statusCode).toBe(200);
  });

  it("returns 400 with expiresIn in an invalid format", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/auth/token",
      payload: { database: "project1", secret: TEST_ADMIN_SECRET, expiresIn: "onehour" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/Invalid expiresIn/);
  });
});

describe("POST /auth/token/admin — expiresIn limits", () => {
  it("returns 400 with expiresIn '25h' (max 24h exceeded)", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/auth/token/admin",
      payload: { adminSecret: TEST_ADMIN_SECRET, expiresIn: "25h" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/24h/);
  });

  it("returns 200 with expiresIn '24h' (exactly at the limit)", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/auth/token/admin",
      payload: { adminSecret: TEST_ADMIN_SECRET, expiresIn: "24h" },
    });
    expect(res.statusCode).toBe(200);
  });

  it("returns 400 with expiresIn 'abc' (invalid format)", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/auth/token/admin",
      payload: { adminSecret: TEST_ADMIN_SECRET, expiresIn: "abc" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/Invalid expiresIn/);
  });

  it("returns 401 in a timing-safe manner for wrong admin secret", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/auth/token/admin",
      payload: { adminSecret: "completely-wrong-secret-123456" },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe("Invalid admin secret");
  });
});
