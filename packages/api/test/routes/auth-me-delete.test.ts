/**
 * Test: Issue #8 Fix — DELETE /db/:db/auth/me endpoint.
 *
 * An endpoint that deletes the user's own account was added to users.ts.
 * - Requires a per-DB user token (admin token is rejected)
 * - Deletes only the account of the token owner
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { JwtService } from "../../src/services/jwtService.js";

const JWT_SECRET = "test-secret-must-be-at-least-32-characters-long";

vi.stubEnv("JWT_SECRET", JWT_SECRET);
vi.stubEnv("ADMIN_SECRET", "test-admin-secret-16ch");

const deletedUsers: string[] = [];

vi.mock("postgres", () => {
  const sqlMock = vi.fn(() => {
    const fn = vi.fn().mockImplementation(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const query = strings.join(" ").toLowerCase();

      if (query.includes("select password_hash from _postgrify_auth.users")) {
        // Mock user for password verification
        return [{ password_hash: "$argon2id$v=19$m=65536,t=3,p=4$fake$fake" }];
      }
      if (query.includes("delete from _postgrify_auth.users")) {
        deletedUsers.push(values[0] as string);
        return [];
      }
      if (query.includes("update _postgrify_auth.sessions")) {
        return [];
      }
      return [];
    }) as unknown as Record<string, unknown>;
    fn.unsafe = vi.fn().mockResolvedValue([]);
    fn.end = vi.fn().mockResolvedValue(undefined);
    fn.begin = vi.fn().mockImplementation((_: string, cb: (tx: unknown) => unknown) => cb(fn));
    return fn;
  });
  return { default: sqlMock };
});

vi.mock("../../src/services/cacheService.js", () => ({
  CacheService: vi.fn().mockImplementation(() => ({
    connect: vi.fn(),
    disconnect: vi.fn(),
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn(),
    del: vi.fn(),
    invalidatePattern: vi.fn(),
    buildKey: (...p: string[]) => p.join(":"),
  })),
  TTL: { ROW_QUERY: 30, SCHEMA: 300, TABLE_LIST: 120, DB_SIZE: 60 },
}));

vi.mock("../../src/routes/db/auth/provision.js", () => ({
  ensureAuthSchema: vi.fn().mockResolvedValue(undefined),
  insertAuditLog: vi.fn().mockResolvedValue(undefined),
  getAuthSetting: vi.fn().mockResolvedValue("false"),
}));

// verifyPassword: skip password verification in the test environment
vi.mock("../../src/services/passwordService.js", () => ({
  hashPassword: vi.fn().mockResolvedValue("$argon2id$hashed"),
  verifyPassword: vi.fn().mockResolvedValue(true),
}));

let server: FastifyInstance;
let jwtSvc: JwtService;

beforeAll(async () => {
  server = Fastify({ logger: false });

  const { PoolManager } = await import("../../src/services/poolManager.js");
  const { CacheService } = await import("../../src/services/cacheService.js");

  server.decorate("poolManager", new PoolManager({} as never));
  server.decorate("cache", new CacheService());
  server.decorateRequest("user", null);
  server.decorateRequest("dbName", "testdb");
  server.decorateRequest("dbUser", null);

  jwtSvc = new JwtService(JWT_SECRET);

  // users.ts handlers access server.jwtService directly
  server.decorate("jwtService", jwtSvc);

  server.decorate("authenticate", async (req: Parameters<typeof server.authenticate>[0], reply: Parameters<typeof server.authenticate>[1]) => {
    const auth = req.headers.authorization;
    if (!auth?.startsWith("Bearer ")) return reply.status(401).send({ error: "Unauthorized" });
    const payload = await jwtSvc.verifyAdminOrDb(auth.slice(7));
    if (!payload) return reply.status(401).send({ error: "Invalid" });
    req.user = payload;
  });

  server.decorate("authenticateAdmin", async () => {});

  server.decorate("authenticateAny", async (req: Parameters<typeof server.authenticateAny>[0], reply: Parameters<typeof server.authenticateAny>[1]) => {
    const auth = req.headers.authorization;
    if (!auth?.startsWith("Bearer ")) return reply.status(401).send({ error: "Unauthorized" });
    const token = auth.slice(7);
    const adminOrDb = await jwtSvc.verifyAdminOrDb(token);
    if (adminOrDb) { req.user = adminOrDb; return; }
    const dbUser = await jwtSvc.verifyDbUser(token);
    if (dbUser) { req.dbUser = dbUser; return; }
    return reply.status(401).send({ error: "Invalid token" });
  });

  server.addHook("preHandler", async (req) => { req.dbName = "testdb"; });

  const { authUsersRoute } = await import("../../src/routes/db/auth/users.js");
  await server.register(authUsersRoute);
  await server.ready();
});

afterAll(() => server.close());

describe("Issue #8 — DELETE /auth/me", () => {
  it("should be able to delete own account with a DB-user token", async () => {
    deletedUsers.length = 0;

    const userToken = await jwtSvc.signDbUserToken("testdb", "user-to-delete", "user@test.com", "editor");

    const res = await server.inject({
      method: "DELETE",
      url: "/testdb/auth/me",
      headers: { authorization: `Bearer ${userToken}`, "content-type": "application/json" },
      payload: {},
    });

    expect(res.statusCode, `DELETE /auth/me error: ${res.body}`).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
  });

  it("DELETE /auth/me should be rejected with an admin token", async () => {
    const adminToken = await jwtSvc.signAdminToken();

    const res = await server.inject({
      method: "DELETE",
      url: "/testdb/auth/me",
      headers: { authorization: `Bearer ${adminToken}` },
    });

    // Admin token is not a per-DB user — expecting 403
    expect(res.statusCode).toBe(403);
  });

  it("DELETE /auth/me should return 401 without a token", async () => {
    const res = await server.inject({
      method: "DELETE",
      url: "/testdb/auth/me",
    });

    expect(res.statusCode).toBe(401);
  });

  it("token for a different DB should be rejected", async () => {
    const wrongDbToken = await jwtSvc.signDbUserToken("other-db", "user-123", "user@test.com", "editor");

    const res = await server.inject({
      method: "DELETE",
      url: "/testdb/auth/me",
      headers: { authorization: `Bearer ${wrongDbToken}` },
    });

    expect(res.statusCode).toBe(403);
  });
});