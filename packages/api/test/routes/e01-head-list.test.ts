/**
 * E-01 — HEAD /db/:database/:table
 *
 * PostgREST: identical to GET except no body (RFC 9110).
 * Optimization: limit=0 skips row SELECT; Prefer:count still runs COUNT.
 *
 * Refs:
 * - https://postgrest.org/en/stable/references/api/tables_views.html#head
 * - https://docs.postgrest.org/en/v12/references/api/pagination_count.html
 * - missing-endpoints.md E-01
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { JwtService } from "../../src/services/jwtService.js";

const JWT_SECRET = "test-secret-must-be-at-least-32-characters";
const ADMIN_SECRET = "test-admin-secret-16ch";

vi.stubEnv("JWT_SECRET", JWT_SECRET);
vi.stubEnv("ADMIN_SECRET", ADMIN_SECRET);

const MOCK_ROWS = [
  { id: 1, name: "Alice" },
  { id: 2, name: "Bob" },
];

const unsafeCalls: { sql: string; params?: unknown[] }[] = [];

vi.mock("postgres", () => {
  const sqlMock = vi.fn(() => {
    const fn = vi.fn().mockResolvedValue(MOCK_ROWS) as unknown as Record<string, unknown>;
    fn.unsafe = vi.fn().mockResolvedValue(MOCK_ROWS);
    fn.end = vi.fn().mockResolvedValue(undefined);
    fn.begin = vi.fn().mockImplementation((_mode: string, cb: (sql: unknown) => unknown) => {
      const tx = {
        unsafe: vi.fn().mockImplementation((sql: string, params?: unknown[]) => {
          unsafeCalls.push({ sql, params });
          if (/count\(\*\)/i.test(sql)) return Promise.resolve([{ total: "42" }]);
          if (/EXPLAIN/i.test(sql)) {
            return Promise.resolve([{ "QUERY PLAN": [{ Plan: { "Plan Rows": 99 } }] }]);
          }
          if (/reltuples/i.test(sql)) return Promise.resolve([{ total: "1000" }]);
          return Promise.resolve(MOCK_ROWS);
        }),
      };
      return cb(tx);
    });
    return fn;
  });
  return { default: sqlMock };
});

vi.mock("../../src/services/cacheService.js", () => ({
  CacheService: vi.fn().mockImplementation(() => ({
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
    del: vi.fn().mockResolvedValue(undefined),
    invalidatePattern: vi.fn().mockResolvedValue(undefined),
    buildKey: (...p: string[]) => `postgrify:${p.join(":")}`,
  })),
  TTL: { ROW_QUERY: 30, SCHEMA: 300, TABLE_LIST: 120, DB_SIZE: 60 },
}));

let server: FastifyInstance;
let readToken: string;
let writeOnlyToken: string;

beforeAll(async () => {
  server = Fastify({ logger: false });

  const { PoolManager } = await import("../../src/services/poolManager.js");
  const { CacheService } = await import("../../src/services/cacheService.js");
  const { JwtService: Jwt } = await import("../../src/services/jwtService.js");
  const jwtSvc = new Jwt(JWT_SECRET);

  server.decorate("poolManager", new PoolManager({} as never));
  server.decorate("cache", new CacheService());
  server.decorateRequest("user", null);
  server.decorateRequest("dbName", null);
  server.decorateRequest("dbUser", null);

  server.decorate("authenticate", async (req: never, reply: never) => {
    const auth = (req as { headers: Record<string, string> }).headers.authorization;
    if (!auth?.startsWith("Bearer ")) {
      return (reply as { status: (n: number) => { send: (b: unknown) => void } })
        .status(401)
        .send({ error: "Unauthorized" });
    }
    const payload = await jwtSvc.verifyAdminOrDb(auth.slice(7));
    if (!payload) {
      return (reply as { status: (n: number) => { send: (b: unknown) => void } })
        .status(401)
        .send({ error: "Invalid" });
    }
    (req as { user: unknown }).user = payload;
  });

  server.decorate("authenticateAdmin", async () => {});
  server.decorate("authenticateAny", async (req: never, reply: never) => {
    return (server as never as { authenticate: (r: never, rep: never) => Promise<void> }).authenticate(
      req,
      reply
    );
  });

  const { dbRoutes } = await import("../../src/routes/db/index.js");
  await server.register(dbRoutes, { prefix: "/db" });
  await server.ready();

  const jwt = new JwtService(JWT_SECRET);
  readToken = await jwt.signDbToken("project1", ["read"]);
  writeOnlyToken = await jwt.signDbToken("project1", ["write"]);
});

afterAll(async () => {
  await server.close();
  vi.unstubAllEnvs();
});

beforeEach(() => {
  unsafeCalls.length = 0;
});

describe("E-01 HEAD /db/:database/:table — contract", () => {
  it("returns 200 with empty body", async () => {
    const res = await server.inject({
      method: "HEAD",
      url: "/db/project1/users?limit=2",
      headers: { Authorization: `Bearer ${readToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe("");
    expect(res.headers["content-range"]).toBe("0-1/*");
    expect(res.headers["range-unit"]).toBe("items");
  });

  it("Prefer:count=exact sets Content-Range total without body", async () => {
    const res = await server.inject({
      method: "HEAD",
      url: "/db/project1/users?limit=2",
      headers: {
        Authorization: `Bearer ${readToken}`,
        Prefer: "count=exact",
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe("");
    expect(res.headers["content-range"]).toBe("0-1/42");
    expect(res.headers["x-total-count"]).toBe("42");
  });

  it("limit=0 + Prefer:count=exact skips SELECT, only COUNT (*/42)", async () => {
    const res = await server.inject({
      method: "HEAD",
      url: "/db/project1/users?limit=0",
      headers: {
        Authorization: `Bearer ${readToken}`,
        Prefer: "count=exact",
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe("");
    expect(res.headers["content-range"]).toBe("*/42");
    const selects = unsafeCalls.filter(
      (c) => /SELECT/i.test(c.sql) && !/count\(\*\)/i.test(c.sql) && !/EXPLAIN/i.test(c.sql) && !/reltuples/i.test(c.sql)
    );
    expect(selects.length).toBe(0);
    expect(unsafeCalls.some((c) => /count\(\*\)/i.test(c.sql))).toBe(true);
  });

  it("limit=0 without Prefer:count → */* and no COUNT", async () => {
    const res = await server.inject({
      method: "HEAD",
      url: "/db/project1/users?limit=0",
      headers: { Authorization: `Bearer ${readToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-range"]).toBe("*/*");
    expect(unsafeCalls.some((c) => /count\(\*\)/i.test(c.sql))).toBe(false);
  });
});

describe("E-01 HEAD — security", () => {
  it("401 without token", async () => {
    const res = await server.inject({ method: "HEAD", url: "/db/project1/users" });
    expect(res.statusCode).toBe(401);
  });

  it("403 write-only scope", async () => {
    const res = await server.inject({
      method: "HEAD",
      url: "/db/project1/users",
      headers: { Authorization: `Bearer ${writeOnlyToken}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it("400 evil table name (no SQL)", async () => {
    const res = await server.inject({
      method: "HEAD",
      url: `/db/project1/${encodeURIComponent("users;DROP")}`,
      headers: { Authorization: `Bearer ${readToken}` },
    });
    expect(res.statusCode).toBe(400);
    expect(unsafeCalls.length).toBe(0);
  });

  it("Prefer:count without auth still 401", async () => {
    const res = await server.inject({
      method: "HEAD",
      url: "/db/project1/users?limit=0",
      headers: { Prefer: "count=exact" },
    });
    expect(res.statusCode).toBe(401);
  });
});
