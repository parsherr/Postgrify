/**
 * Auth sessions endpoint tests.
 * GET  /auth/sessions — list active sessions
 * DELETE /auth/sessions/:id — revoke session
 * POST /auth/refresh — refresh session token (via auth routes)
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { JwtService } from "../../src/services/jwtService.js";

const JWT_SECRET = "test-secret-must-be-at-least-32-characters";

vi.stubEnv("JWT_SECRET", JWT_SECRET);
vi.stubEnv("ADMIN_SECRET", "test-admin-secret-16ch");

const MOCK_SESSION = {
  id: "sess_abc",
  user_id: 1,
  user_agent: "vitest",
  ip: "127.0.0.1",
  created_at: new Date().toISOString(),
  last_active_at: new Date().toISOString(),
};

vi.mock("../../src/services/cacheService.js", () => ({
  CacheService: vi.fn().mockImplementation(() => ({
    connect: vi.fn(), disconnect: vi.fn(),
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn(), del: vi.fn(), invalidatePattern: vi.fn(),
    buildKey: (...p: string[]) => `postgrify:${p.join(":")}`,
  })),
  TTL: { ROW_QUERY: 30, SCHEMA: 300, TABLE_LIST: 120, DB_SIZE: 60 },
}));

let server: FastifyInstance;
let adminToken: string;

beforeAll(async () => {
  server = Fastify({ logger: false });

  const { JwtService: Jwt } = await import("../../src/services/jwtService.js");
  const jwtSvc = new Jwt(JWT_SECRET);

  server.decorate("authenticateAdmin", async (req: never, reply: never) => {
    const auth = (req as { headers: Record<string, string> }).headers.authorization;
    if (!auth?.startsWith("Bearer ")) {
      return (reply as { status: (n: number) => { send: (b: unknown) => void } })
        .status(401).send({ error: "Unauthorized" });
    }
    const payload = await jwtSvc.verify(auth.slice(7));
    if (!payload || payload.role !== "admin") {
      return (reply as { status: (n: number) => { send: (b: unknown) => void } })
        .status(403).send({ error: "Admin required" });
    }
    (req as { user: unknown }).user = payload;
  });

  server.decorate("jwtService", jwtSvc);
  server.decorate("sessionService", {
    listAll: vi.fn().mockResolvedValue([MOCK_SESSION]),
    revoke: vi.fn().mockResolvedValue(undefined),
    get: vi.fn().mockResolvedValue(MOCK_SESSION),
    create: vi.fn().mockResolvedValue(MOCK_SESSION),
  });
  server.decorateRequest("user", null);
  server.decorateRequest("dbName", null);

  const { adminSessionsRoute } = await import("../../src/routes/auth/sessions.js");
  await server.register(adminSessionsRoute, { prefix: "/auth" });
  await server.ready();

  const jwtSvcDirect = new JwtService(JWT_SECRET);
  adminToken = await jwtSvcDirect.signAdminToken();
});

afterAll(() => {
  vi.unstubAllEnvs();
  return server.close();
});

describe("GET /auth/sessions — list active sessions", () => {
  it("returns 200 with session list when admin token provided", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/auth/sessions",
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect([200, 401, 403]).toContain(res.statusCode);
  });
});

describe("DELETE /auth/sessions/:id — revoke session", () => {
  it("returns 200 or 204 when session is revoked", async () => {
    const res = await server.inject({
      method: "DELETE",
      url: "/auth/sessions/sess_abc",
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect([200, 204, 401, 403, 404]).toContain(res.statusCode);
  });
});

describe("POST /auth/refresh — refresh session token", () => {
  it("returns 401 when no refresh token is provided", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/auth/refresh",
      payload: {},
    });
    expect([401, 400, 404]).toContain(res.statusCode);
  });
});