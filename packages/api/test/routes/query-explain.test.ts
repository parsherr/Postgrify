/**
 * E-87 POST /db/:database/query/explain tests.
 */

import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { JwtService } from "../../src/services/jwtService.js";

const JWT_SECRET = "test-secret-must-be-at-least-32-characters";

vi.stubEnv("JWT_SECRET", JWT_SECRET);
vi.stubEnv("ADMIN_SECRET", "test-admin-secret-16ch");
vi.stubEnv("ALLOW_RAW_SQL_ADMIN", "false");

const MOCK_PLAN = [
  {
    Plan: {
      "Node Type": "Seq Scan",
      "Relation Name": "orders",
      "Actual Rows": 1500,
      "Actual Total Time": 12.34,
    },
    "Planning Time": 0.1,
    "Execution Time": 12.5,
  },
];

vi.mock("postgres", () => {
  const sqlFn = vi.fn().mockResolvedValue([]) as unknown as Record<string, unknown>;
  sqlFn.unsafe = vi.fn().mockResolvedValue([{ "QUERY PLAN": MOCK_PLAN }]);
  sqlFn.end = vi.fn().mockResolvedValue(undefined);
  sqlFn.begin = vi.fn().mockImplementation((_mode: string, cb: (sql: unknown) => unknown) => {
    return cb(sqlFn);
  });
  return { default: vi.fn(() => sqlFn) };
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
    redisClient: null,
  })),
  TTL: { ROW_QUERY: 30, SCHEMA: 300, TABLE_LIST: 120, DB_SIZE: 60 },
}));

let server: FastifyInstance;
let adminToken: string;
let queryToken: string;
let readOnlyToken: string;
let sqlUnsafe: ReturnType<typeof vi.fn>;

beforeAll(async () => {
  server = Fastify({ logger: false });

  const { PoolManager } = await import("../../src/services/poolManager.js");
  const { CacheService } = await import("../../src/services/cacheService.js");
  const { JwtService: Jwt } = await import("../../src/services/jwtService.js");
  const jwtSvc = new Jwt(JWT_SECRET);
  const { default: postgres } = await import("postgres");
  const sqlFn = (postgres as unknown as ReturnType<typeof vi.fn>)();
  sqlUnsafe = sqlFn.unsafe as ReturnType<typeof vi.fn>;

  server.decorate("poolManager", new PoolManager({} as never));
  server.decorate("cache", new CacheService());
  server.decorateRequest("user", null);
  server.decorateRequest("dbName", null);

  server.decorate("authenticate", async (req: never, reply: never) => {
    const auth = (req as { headers: Record<string, string> }).headers
      .authorization;
    if (!auth?.startsWith("Bearer ")) {
      return (
        reply as { status: (n: number) => { send: (b: unknown) => void } }
      )
        .status(401)
        .send({ error: "Unauthorized" });
    }
    const payload = await jwtSvc.verify(auth.slice(7));
    if (!payload) {
      return (
        reply as { status: (n: number) => { send: (b: unknown) => void } }
      )
        .status(401)
        .send({ error: "Invalid" });
    }
    (req as { user: unknown }).user = payload;
  });
  server.decorate("authenticateAdmin", async () => {});
  server.decorate("authenticateAny", async (req: never, reply: never) => {
    return (
      server as never as {
        authenticate: (r: never, rep: never) => Promise<void>;
      }
    ).authenticate(req, reply);
  });

  const { dbRoutes } = await import("../../src/routes/db/index.js");
  await server.register(dbRoutes, { prefix: "/db" });
  await server.ready();

  const jwtSvcDirect = new JwtService(JWT_SECRET);
  adminToken = await jwtSvcDirect.signAdminToken();
  queryToken = await jwtSvcDirect.signDbToken("project1", ["read", "query"]);
  readOnlyToken = await jwtSvcDirect.signDbToken("project1", ["read"]);
});

afterAll(async () => {
  await server.close();
  vi.unstubAllEnvs();
});

beforeEach(() => {
  sqlUnsafe.mockResolvedValue([{ "QUERY PLAN": MOCK_PLAN }]);
});

describe("POST /db/:database/query/explain (E-87)", () => {
  it("returns structured Plan for SELECT", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/db/project1/query/explain",
      headers: { Authorization: `Bearer ${queryToken}` },
      payload: {
        sql: "SELECT * FROM orders WHERE status = 'pending'",
        analyze: true,
        buffers: true,
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.Plan["Node Type"]).toBe("Seq Scan");
    expect(body.Plan["Relation Name"]).toBe("orders");
    expect(body.options).toEqual({
      analyze: true,
      buffers: true,
      verbose: false,
      settings: false,
      wal: false,
    });
    const calledSql = String(sqlUnsafe.mock.calls[0]?.[0] ?? "");
    expect(calledSql).toMatch(/^EXPLAIN \(FORMAT JSON, ANALYZE, BUFFERS\)/i);
  });

  it("buffers implies analyze in options", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/db/project1/query/explain",
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: { sql: "SELECT 1", buffers: true },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().options.analyze).toBe(true);
    expect(res.json().options.buffers).toBe(true);
  });

  it("rejects DROP in SELECT-only mode", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/db/project1/query/explain",
      headers: { Authorization: `Bearer ${queryToken}` },
      payload: { sql: "DROP TABLE orders" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("rejects sql that already starts with EXPLAIN", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/db/project1/query/explain",
      headers: { Authorization: `Bearer ${queryToken}` },
      payload: { sql: "EXPLAIN SELECT 1" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("read-only token → 403", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/db/project1/query/explain",
      headers: { Authorization: `Bearer ${readOnlyToken}` },
      payload: { sql: "SELECT 1" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("no token → 401", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/db/project1/query/explain",
      payload: { sql: "SELECT 1" },
    });
    expect(res.statusCode).toBe(401);
  });
});
