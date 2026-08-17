/**
 * GET  /:database/auth/me tests.
 * PATCH /:database/auth/me tests.
 *
 * Both endpoints require a DB user JWT — admin token is rejected.
 */

import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from "vitest";
import Fastify, { type FastifyInstance, type FastifyRequest, type FastifyReply } from "fastify";
import { JwtService } from "../../../src/services/jwtService.js";

const JWT_SECRET = "test-secret-must-be-at-least-32-characters";

vi.mock("../../../src/routes/db/auth/provision.js", () => ({
  ensureAuthSchema: vi.fn().mockResolvedValue(undefined),
  getApiKey: vi.fn().mockResolvedValue("test-api-key"),
  getAuthSetting: vi.fn().mockResolvedValue("true"),
  insertAuditLog: vi.fn().mockResolvedValue(undefined),
  provisionApiKey: vi.fn().mockResolvedValue("test-api-key"),
}));

vi.mock("postgres", () => {
  const sqlFn = vi.fn().mockResolvedValue([]);
  sqlFn.unsafe = vi.fn().mockResolvedValue([]);
  sqlFn.end = vi.fn().mockResolvedValue(undefined);
  return { default: vi.fn(() => sqlFn) };
});

vi.mock("../../../src/services/cacheService.js", () => ({
  CacheService: vi.fn().mockImplementation(() => ({
    connect: vi.fn(), disconnect: vi.fn(),
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn(), del: vi.fn(), invalidatePattern: vi.fn(),
    buildKey: (...p: string[]) => `postgrify:${p.join(":")}`,
    redisClient: null,
  })),
  TTL: { ROW_QUERY: 30, SCHEMA: 300, TABLE_LIST: 120, DB_SIZE: 60 },
}));

let server: FastifyInstance;
let jwtSvc: JwtService;
let sqlFnRef: ReturnType<typeof vi.fn>;

beforeAll(async () => {
  jwtSvc = new JwtService(JWT_SECRET);

  server = Fastify({ logger: false });

  const { PoolManager } = await import("../../../src/services/poolManager.js");
  const { CacheService } = await import("../../../src/services/cacheService.js");

  const { default: postgres } = await import("postgres");
  sqlFnRef = (postgres as unknown as ReturnType<typeof vi.fn>)();

  server.decorate("poolManager", new PoolManager({} as never));
  server.decorate("cache", new CacheService());
  server.decorateRequest("user", null);
  server.decorateRequest("dbName", null);
  server.decorate("authenticate", async (req: FastifyRequest, reply: FastifyReply) => {
    const auth = req.headers.authorization;
    if (!auth?.startsWith("Bearer ")) return reply.status(401).send({ error: "Unauthorized" });
    const payload = await jwtSvc.verifyAdminOrDb(auth.slice(7));
    if (!payload) return reply.status(401).send({ error: "Invalid token" });
    req.user = payload;
  });
  server.decorate("authenticateAdmin", async () => {});
  // me.ts uses the jwtService decorator
  server.decorate("jwtService", jwtSvc);

  const { authMeRoute } = await import("../../../src/routes/db/auth/me.js");
  await server.register(authMeRoute);
  await server.ready();
});

afterAll(async () => {
  await server.close();
});

beforeEach(() => {
  vi.clearAllMocks();
  sqlFnRef.mockResolvedValue([]);
});

describe("GET /:database/auth/me", () => {
  it("Valid DB user token → 200, returns user object", async () => {
    const dbUserToken = await jwtSvc.signDbUserToken(
      "testdb",
      "user-uuid-1",
      "user@example.com",
      "viewer",
      "1h"
    );

    sqlFnRef.mockResolvedValue([{
      id: "user-uuid-1",
      email: "user@example.com",
      role: "viewer",
      full_name: "Test User",
      avatar_url: null,
      email_verified: true,
      is_active: true,
      provider: "email",
      created_at: "2024-01-01T00:00:00Z",
      last_login: null,
      metadata: {},
    }]);

    const res = await server.inject({
      method: "GET",
      url: "/testdb/auth/me",
      headers: { authorization: `Bearer ${dbUserToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.email).toBe("user@example.com");
    expect(body.role).toBe("viewer");
    // password_hash must not be in the response
    expect(body).not.toHaveProperty("password_hash");
  });

  it("No Authorization header → 401 Missing authorization", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/testdb/auth/me",
      // No header
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().error).toContain("Missing authorization");
  });

  it("Admin token (iss: postgrify) → 401 Invalid or expired token", async () => {
    const adminToken = await jwtSvc.signAdminToken();

    const res = await server.inject({
      method: "GET",
      url: "/testdb/auth/me",
      headers: { authorization: `Bearer ${adminToken}` },
    });

    // verifyDbUser rejects admin tokens
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toContain("Invalid or expired token");
  });

  it("Token issued for a different DB → 403 Token database mismatch", async () => {
    const otherDbToken = await jwtSvc.signDbUserToken(
      "otherdb", // different DB
      "user-uuid-1",
      "user@example.com",
      "viewer",
      "1h"
    );

    const res = await server.inject({
      method: "GET",
      url: "/testdb/auth/me", // requested for testdb but token is for otherdb
      headers: { authorization: `Bearer ${otherDbToken}` },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error).toContain("mismatch");
  });

  it("User not found in DB → 404", async () => {
    const dbUserToken = await jwtSvc.signDbUserToken(
      "testdb",
      "deleted-user-uuid",
      "gone@example.com",
      "viewer",
      "1h"
    );

    sqlFnRef.mockResolvedValue([]); // user not found

    const res = await server.inject({
      method: "GET",
      url: "/testdb/auth/me",
      headers: { authorization: `Bearer ${dbUserToken}` },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error).toContain("not found");
  });
});

describe("PATCH /:database/auth/me — update profile", () => {
  const mockUser = {
    id: "user-uuid-1",
    email: "user@example.com",
    role: "viewer",
    full_name: "Test User",
    avatar_url: null,
    email_verified: true,
    is_active: true,
    provider: "email",
    created_at: "2024-01-01T00:00:00Z",
    last_login: null,
    metadata: {},
  };

  it("update full_name → 200, returns updated user", async () => {
    const dbUserToken = await jwtSvc.signDbUserToken(
      "testdb", "user-uuid-1", "user@example.com", "viewer", "1h"
    );
    sqlFnRef.mockResolvedValue([{ ...mockUser, full_name: "New Name" }]);

    const res = await server.inject({
      method: "PATCH",
      url: "/testdb/auth/me",
      headers: { authorization: `Bearer ${dbUserToken}` },
      payload: { full_name: "New Name" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.full_name).toBe("New Name");
    expect(body).not.toHaveProperty("password_hash");
  });

  it("update avatar_url → 200", async () => {
    const dbUserToken = await jwtSvc.signDbUserToken(
      "testdb", "user-uuid-1", "user@example.com", "viewer", "1h"
    );
    sqlFnRef.mockResolvedValue([{ ...mockUser, avatar_url: "https://example.com/avatar.png" }]);

    const res = await server.inject({
      method: "PATCH",
      url: "/testdb/auth/me",
      headers: { authorization: `Bearer ${dbUserToken}` },
      payload: { avatar_url: "https://example.com/avatar.png" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().avatar_url).toBe("https://example.com/avatar.png");
  });

  it("metadata merge → 200", async () => {
    const dbUserToken = await jwtSvc.signDbUserToken(
      "testdb", "user-uuid-1", "user@example.com", "viewer", "1h"
    );
    sqlFnRef.mockResolvedValue([{ ...mockUser, metadata: { theme: "dark" } }]);

    const res = await server.inject({
      method: "PATCH",
      url: "/testdb/auth/me",
      headers: { authorization: `Bearer ${dbUserToken}` },
      payload: { metadata: { theme: "dark" } },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().metadata).toEqual({ theme: "dark" });
  });

  it("full_name null → clears the field → 200", async () => {
    const dbUserToken = await jwtSvc.signDbUserToken(
      "testdb", "user-uuid-1", "user@example.com", "viewer", "1h"
    );
    sqlFnRef.mockResolvedValue([{ ...mockUser, full_name: null }]);

    const res = await server.inject({
      method: "PATCH",
      url: "/testdb/auth/me",
      headers: { authorization: `Bearer ${dbUserToken}` },
      payload: { full_name: null },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().full_name).toBeNull();
  });

  it("empty body → 400", async () => {
    const dbUserToken = await jwtSvc.signDbUserToken(
      "testdb", "user-uuid-1", "user@example.com", "viewer", "1h"
    );

    const res = await server.inject({
      method: "PATCH",
      url: "/testdb/auth/me",
      headers: { authorization: `Bearer ${dbUserToken}` },
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/empty/i);
  });

  it("Authorization header yok → 401", async () => {
    const res = await server.inject({
      method: "PATCH",
      url: "/testdb/auth/me",
      payload: { full_name: "Test" },
    });

    expect(res.statusCode).toBe(401);
  });

  it("Admin token → 401 (DB user token gerektirir)", async () => {
    const adminToken = await jwtSvc.signAdminToken();

    const res = await server.inject({
      method: "PATCH",
      url: "/testdb/auth/me",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { full_name: "Test" },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().error).toContain("Invalid or expired token");
  });

  it("Token for a different DB → 403 mismatch", async () => {
    const otherDbToken = await jwtSvc.signDbUserToken(
      "otherdb", "user-uuid-1", "user@example.com", "viewer", "1h"
    );

    const res = await server.inject({
      method: "PATCH",
      url: "/testdb/auth/me",
      headers: { authorization: `Bearer ${otherDbToken}` },
      payload: { full_name: "Test" },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error).toContain("mismatch");
  });

  it("User does not exist in DB → 404", async () => {
    const dbUserToken = await jwtSvc.signDbUserToken(
      "testdb", "deleted-uuid", "gone@example.com", "viewer", "1h"
    );
    sqlFnRef.mockResolvedValue([]); // user not found

    const res = await server.inject({
      method: "PATCH",
      url: "/testdb/auth/me",
      headers: { authorization: `Bearer ${dbUserToken}` },
      payload: { full_name: "Ghost" },
    });

    expect(res.statusCode).toBe(404);
  });

  it("returns 400 when a disallowed field (email) is sent → 400 (additionalProperties: false)", async () => {
    const dbUserToken = await jwtSvc.signDbUserToken(
      "testdb", "user-uuid-1", "user@example.com", "viewer", "1h"
    );

    const res = await server.inject({
      method: "PATCH",
      url: "/testdb/auth/me",
      headers: { authorization: `Bearer ${dbUserToken}` },
      payload: { email: "hacker@evil.com" },
    });

    // additionalProperties: false → Fastify validation returns 400
    expect(res.statusCode).toBe(400);
  });
});