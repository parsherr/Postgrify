/**
 * Test: Issue #11 Fix — editor role should have the "query" scope.
 *
 * "query" was added to the DB_USER_ROLE_SCOPES.editor array in scopeGuard.ts.
 * This test verifies that a DB-user token with the editor role can access the /query endpoint.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { JwtService } from "../../src/services/jwtService.js";

const JWT_SECRET = "test-secret-must-be-at-least-32-characters-long";
const ADMIN_SECRET = "test-admin-secret-16ch";

vi.stubEnv("JWT_SECRET", JWT_SECRET);
vi.stubEnv("ADMIN_SECRET", ADMIN_SECRET);
vi.stubEnv("ALLOW_RAW_SQL_ADMIN", "false");

// Mock postgres
vi.mock("postgres", () => {
  const sqlMock = vi.fn(() => {
    const fn = vi.fn().mockResolvedValue([{ id: 1, name: "Alice" }]) as unknown as Record<string, unknown>;
    fn.unsafe = vi.fn().mockResolvedValue([{ id: 1, name: "Alice" }]);
    fn.end = vi.fn().mockResolvedValue(undefined);
    fn.begin = vi.fn().mockImplementation((_mode: string, cb: (sql: unknown) => unknown) => {
      const txFn = vi.fn().mockResolvedValue([{ id: 1 }]) as unknown as Record<string, unknown>;
      txFn.unsafe = vi.fn().mockResolvedValue([{ id: 1 }]);
      return cb(txFn);
    });
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
    buildKey: (...p: string[]) => `postgrify:${p.join(":")}`,
  })),
  TTL: { ROW_QUERY: 30, SCHEMA: 300, TABLE_LIST: 120, DB_SIZE: 60 },
}));

vi.mock("../../src/routes/db/auth/provision.js", () => ({
  insertAuditLog: vi.fn().mockResolvedValue(undefined),
  ensureAuthSchema: vi.fn().mockResolvedValue(undefined),
  getAuthSetting: vi.fn().mockResolvedValue("false"),
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

  // authenticateAny: accept admin or DB-user tokens
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

  server.decorate("authenticate", async (req: Parameters<typeof server.authenticate>[0], reply: Parameters<typeof server.authenticate>[1]) => {
    const auth = req.headers.authorization;
    if (!auth?.startsWith("Bearer ")) return reply.status(401).send({ error: "Unauthorized" });
    const payload = await jwtSvc.verifyAdminOrDb(auth.slice(7));
    if (!payload) return reply.status(401).send({ error: "Invalid token" });
    req.user = payload;
  });

  server.decorate("authenticateAdmin", async () => {});

  server.addHook("preHandler", async (req) => {
    req.dbName = "testdb";
  });

  const { dbRoutes } = await import("../../src/routes/db/index.js");
  await server.register(dbRoutes);
  await server.ready();
});

afterAll(() => server.close());

describe("Issue #11 — editor role query scope", () => {
  it("editor DB-user token should be able to access the /query endpoint", async () => {
    const editorToken = await jwtSvc.signDbUserToken("testdb", "user-123", "editor@test.com", "editor");

    const res = await server.inject({
      method: "POST",
      url: "/testdb/query",
      headers: { authorization: `Bearer ${editorToken}` },
      payload: { sql: "SELECT 1 AS n" },
    });

    // expecting 200 — if 403, the fix did not take effect
    expect(res.statusCode, `editor is getting 403 on /query — scopeGuard fix did not apply:\n${res.body}`).toBe(200);
  });

  it("viewer DB-user token should not be able to access the /query endpoint", async () => {
    const viewerToken = await jwtSvc.signDbUserToken("testdb", "user-456", "viewer@test.com", "viewer");

    const res = await server.inject({
      method: "POST",
      url: "/testdb/query",
      headers: { authorization: `Bearer ${viewerToken}` },
      payload: { sql: "SELECT 1 AS n" },
    });

    // viewer has no query scope — expecting 403
    expect(res.statusCode).toBe(403);
  });

  it("admin DB-user token should be able to access the /query endpoint", async () => {
    const adminToken = await jwtSvc.signDbUserToken("testdb", "user-789", "admin@test.com", "admin");

    const res = await server.inject({
      method: "POST",
      url: "/testdb/query",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { sql: "SELECT 1 AS n" },
    });

    expect(res.statusCode).toBe(200);
  });

  it("editor token should have the write scope (rows POST)", async () => {
    const editorToken = await jwtSvc.signDbUserToken("testdb", "user-123", "editor@test.com", "editor");

    const res = await server.inject({
      method: "POST",
      url: "/testdb/users",
      headers: { authorization: `Bearer ${editorToken}` },
      payload: { username: "testuser", display_name: "Test User" },
    });

    // expecting 201 or 200 (mock returns a row)
    expect([200, 201]).toContain(res.statusCode);
  });

  it("viewer token should be denied the write scope (rows POST)", async () => {
    const viewerToken = await jwtSvc.signDbUserToken("testdb", "user-456", "viewer@test.com", "viewer");

    const res = await server.inject({
      method: "POST",
      url: "/testdb/users",
      headers: { authorization: `Bearer ${viewerToken}` },
      payload: { username: "testuser" },
    });

    expect(res.statusCode).toBe(403);
  });
});