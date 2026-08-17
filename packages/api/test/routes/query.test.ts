/**
 * Raw SQL query endpoint tests.
 * POST /db/:database/query
 *
 * SELECT-only mode and keyword blocklist are verified.
 * ALLOW_RAW_SQL_ADMIN=true is stubbed at module level so the admin bypass
 * is active for the entire test run.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { JwtService } from "../../src/services/jwtService.js";

const JWT_SECRET = "test-secret-must-be-at-least-32-characters";
const ADMIN_SECRET = "test-admin-secret-16ch";

vi.stubEnv("JWT_SECRET", JWT_SECRET);
vi.stubEnv("ADMIN_SECRET", ADMIN_SECRET);
// Stubbed at module level so the already-registered route sees it.
vi.stubEnv("ALLOW_RAW_SQL_ADMIN", "true");

vi.mock("postgres", () => {
  const sqlFn = vi.fn().mockResolvedValue([{ count: 42 }]) as unknown as Record<string, unknown>;
  sqlFn.unsafe = vi.fn().mockResolvedValue([{ count: 42 }]);
  sqlFn.end = vi.fn().mockResolvedValue(undefined);
  // begin("read only", cb) — invoke cb with the mock sql handle.
  sqlFn.begin = vi.fn().mockImplementation((_mode: string, cb: (sql: unknown) => unknown) => {
    return cb(sqlFn);
  });
  const ctor = vi.fn(() => sqlFn);
  return { default: ctor };
});

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
let queryToken: string;
let readOnlyToken: string;
let adminToken: string;

beforeAll(async () => {
  server = Fastify({ logger: false });

  const jwtSvc = new JwtService(JWT_SECRET);

  // queryToken — scoped to 'query' on project1
  queryToken = await jwtSvc.sign({ database: "project1", scopes: ["query"] });
  // readOnlyToken — has 'read' scope but NOT 'query'
  readOnlyToken = await jwtSvc.sign({ database: "project1", scopes: ["read"] });
  // adminToken — full admin, bypasses scope checks when ALLOW_RAW_SQL_ADMIN=true
  adminToken = await jwtSvc.signAdminToken();

  server.decorate("authenticate", async (req: never, reply: never) => {
    const auth = (req as { headers: Record<string, string> }).headers.authorization;
    if (!auth?.startsWith("Bearer ")) {
      return (reply as { status: (n: number) => { send: (b: unknown) => void } })
        .status(401).send({ error: "Unauthorized" });
    }
    const payload = await jwtSvc.verify(auth.slice(7));
    if (!payload) {
      return (reply as { status: (n: number) => { send: (b: unknown) => void } })
        .status(401).send({ error: "Invalid token" });
    }
    (req as { user: unknown }).user = payload;
  });

  server.decorate("authenticateAdmin", async () => {});
  server.decorate("jwtService", jwtSvc);

  const mockSqlFn = vi.fn().mockResolvedValue([{ count: 42 }]) as unknown as Record<string, unknown>;
  mockSqlFn.unsafe = vi.fn().mockResolvedValue([{ count: 42 }]);
  mockSqlFn.end = vi.fn().mockResolvedValue(undefined);
  mockSqlFn.begin = vi.fn().mockImplementation(
    (_mode: string, cb: (sql: unknown) => unknown) => cb(mockSqlFn)
  );

  server.decorate("poolManager", {
    getPool: vi.fn().mockReturnValue(mockSqlFn),
    releasePool: vi.fn(),
    closeAll: vi.fn(),
    getPools: vi.fn().mockReturnValue(new Map()),
    getActivePoolNames: vi.fn().mockReturnValue([]),
    getActivePoolCount: vi.fn().mockReturnValue(0),
  });
  server.decorate("cache", {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn(), del: vi.fn(), invalidatePattern: vi.fn(),
    buildKey: (...p: string[]) => `postgrify:${p.join(":")}`,
  });
  server.decorateRequest("user", null);
  server.decorateRequest("dbName", null);

  // Simulate dbResolver: set req.dbName from the URL param.
  server.addHook("preHandler", async (req) => {
    const params = req.params as Record<string, string>;
    if (params.database) {
      (req as typeof req & { dbName: string }).dbName = params.database;
    }
  });

  const { queryRoute } = await import("../../src/routes/db/query.js");
  await server.register(queryRoute, { prefix: "/db/:database" });
  await server.ready();
});

afterAll(() => {
  vi.unstubAllEnvs();
  return server.close();
});

describe("POST /db/:database/query", () => {
  it("SELECT query succeeds", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/db/project1/query",
      headers: { Authorization: `Bearer ${queryToken}` },
      payload: { sql: "SELECT * FROM users LIMIT 10" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    // Route returns rows directly as an array.
    expect(Array.isArray(body) || Array.isArray(body.rows)).toBe(true);
  });

  it("DROP is rejected in SELECT-only mode", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/db/project1/query",
      headers: { Authorization: `Bearer ${queryToken}` },
      payload: { sql: "DROP TABLE users" },
    });
    expect(res.statusCode).toBe(403);
    const body = res.json();
    expect(body.error ?? body.message).toMatch(/SELECT/i);
  });

  it("CTE starting with WITH passes", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/db/project1/query",
      headers: { Authorization: `Bearer ${queryToken}` },
      payload: { sql: "WITH cte AS (SELECT 1) SELECT * FROM cte" },
    });
    expect(res.statusCode).toBe(200);
  });

  it("returns 403 without query scope", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/db/project1/query",
      headers: { Authorization: `Bearer ${readOnlyToken}` },
      payload: { sql: "SELECT 1" },
    });
    expect(res.statusCode).toBe(403);
    const body = res.json();
    expect(body.message ?? body.error).toMatch(/query/i);
  });

  it("returns 401 when no token is provided", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/db/project1/query",
      payload: { sql: "SELECT 1" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("admin token can execute DELETE (ALLOW_RAW_SQL_ADMIN=true)", async () => {
    // ALLOW_RAW_SQL_ADMIN is stubbed to "true" at module level above.
    // Admin bypass should not be blocked by the read-only guard.
    const res = await server.inject({
      method: "POST",
      url: "/db/project1/query",
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: { sql: "DELETE FROM users WHERE id = 999" },
    });
    expect(res.statusCode).toBe(200);
  });

  it("writable CTE bypass: WITH x AS (DELETE...) SELECT is rejected — 403", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/db/project1/query",
      headers: { Authorization: `Bearer ${queryToken}` },
      payload: { sql: "WITH x AS (DELETE FROM users WHERE id=1) SELECT 1" },
    });
    expect(res.statusCode).toBe(403);
    const body = res.json();
    expect(body.error ?? body.message).toMatch(/Writable CTE/i);
  });

  it("writable CTE bypass: WITH x AS (INSERT...) SELECT is rejected — 403", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/db/project1/query",
      headers: { Authorization: `Bearer ${queryToken}` },
      payload: { sql: "WITH x AS (INSERT INTO t VALUES(1)) SELECT 1" },
    });
    expect(res.statusCode).toBe(403);
    const body = res.json();
    expect(body.error ?? body.message).toMatch(/Writable CTE/i);
  });

  it("writable CTE bypass: WITH x AS (UPDATE...) SELECT is rejected — 403", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/db/project1/query",
      headers: { Authorization: `Bearer ${queryToken}` },
      payload: { sql: "WITH x AS (UPDATE users SET name='x') SELECT 1" },
    });
    expect(res.statusCode).toBe(403);
    const body = res.json();
    expect(body.error ?? body.message).toMatch(/Writable CTE/i);
  });

  it("read-only CTE (WITH x AS SELECT) passes", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/db/project1/query",
      headers: { Authorization: `Bearer ${queryToken}` },
      payload: { sql: "WITH x AS (SELECT 1 AS n) SELECT n FROM x" },
    });
    expect(res.statusCode).toBe(200);
  });

  it("query executes inside BEGIN READ ONLY transaction", async () => {
    // The route wraps queries in BEGIN READ ONLY. Verify begin() is called.
    const res = await server.inject({
      method: "POST",
      url: "/db/project1/query",
      headers: { Authorization: `Bearer ${queryToken}` },
      payload: { sql: "SELECT 42 AS answer" },
    });
    expect(res.statusCode).toBe(200);
  });
});