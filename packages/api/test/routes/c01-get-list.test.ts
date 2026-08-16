/**
 * C-01 — GET /db/:database/:table PostgREST-compatible list response.
 *
 * Contract (PostgREST v12 pagination_count):
 * - Body is a JSON array (not { rows, total, ... })
 * - Content-Range + Range-Unit: items always set
 * - Without Prefer:count → Content-Range end with /*
 * - Prefer: count=exact → COUNT(*) and Content-Range …/total + X-Total-Count
 *
 * Ref: https://docs.postgrest.org/en/v12/references/api/pagination_count.html
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
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

vi.mock("postgres", () => {
  const sqlMock = vi.fn(() => {
    const fn = vi.fn().mockResolvedValue(MOCK_ROWS) as unknown as Record<string, unknown>;
    fn.unsafe = vi.fn().mockResolvedValue(MOCK_ROWS);
    fn.end = vi.fn().mockResolvedValue(undefined);
    fn.begin = vi.fn().mockImplementation((_mode: string, cb: (sql: unknown) => unknown) => {
      const tx = {
        unsafe: vi.fn().mockImplementation((sql: string) => {
          if (/count\(\*\)/i.test(sql)) return Promise.resolve([{ total: "42" }]);
          if (/EXPLAIN/i.test(sql)) {
            return Promise.resolve([
              { "QUERY PLAN": [{ Plan: { "Plan Rows": 99 } }] },
            ]);
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

  server.addHook("preHandler", async (req) => {
    (req as { dbName: string }).dbName = "project1";
  });

  const { dbRoutes } = await import("../../src/routes/db/index.js");
  await server.register(dbRoutes);
  await server.ready();

  readToken = await new JwtService(JWT_SECRET).signDbToken("project1", ["read"]);
});

afterAll(async () => {
  await server.close();
  vi.unstubAllEnvs();
});

describe("C-01 GET /db/:database/:table", () => {
  it("body is a JSON array (no rows/total wrapper)", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/project1/users",
      headers: { Authorization: `Bearer ${readToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toEqual(MOCK_ROWS);
    expect(body).not.toHaveProperty("rows");
    expect(body).not.toHaveProperty("total");
  });

  it("sets Content-Range with /* when Prefer:count is absent", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/project1/users?limit=2&offset=0",
      headers: { Authorization: `Bearer ${readToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["range-unit"]).toBe("items");
    expect(res.headers["content-range"]).toBe("0-1/*");
    expect(res.headers["x-total-count"]).toBeUndefined();
  });

  it("Prefer: count=exact → Content-Range …/total and X-Total-Count", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/project1/users?limit=2&offset=0",
      headers: {
        Authorization: `Bearer ${readToken}`,
        Prefer: "count=exact",
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-range"]).toBe("0-1/42");
    expect(res.headers["x-total-count"]).toBe("42");
    expect(Array.isArray(res.json())).toBe(true);
  });

  it("Prefer: count=planned uses EXPLAIN plan rows", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/project1/users?limit=2",
      headers: {
        Authorization: `Bearer ${readToken}`,
        Prefer: "count=planned",
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-range"]).toBe("0-1/99");
  });

  it("Prefer: count=estimated uses reltuples", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/project1/users?limit=2",
      headers: {
        Authorization: `Bearer ${readToken}`,
        Prefer: "count=estimated",
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-range"]).toBe("0-1/1000");
  });

  it("offset reflected in Content-Range start-end", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/project1/users?limit=2&offset=10",
      headers: {
        Authorization: `Bearer ${readToken}`,
        Prefer: "count=exact",
      },
    });
    expect(res.headers["content-range"]).toBe("10-11/42");
  });

  it("still requires auth (401 without token)", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/project1/users",
    });
    expect(res.statusCode).toBe(401);
  });

  it("E-21 Range: 0-0 → 206 + Content-Range", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/project1/users",
      headers: {
        Authorization: `Bearer ${readToken}`,
        Range: "0-0",
        "Range-Unit": "items",
      },
    });
    expect(res.statusCode).toBe(206);
    expect(res.headers["range-unit"]).toBe("items");
    // Mock returns 2 rows regardless of LIMIT; Content-Range reflects returned rows.
    expect(res.headers["content-range"]).toMatch(/^0-\d+\//);
    expect(Array.isArray(res.json())).toBe(true);
  });

  it("E-21 Range items=0-19 → 206", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/project1/users?limit=100",
      headers: {
        Authorization: `Bearer ${readToken}`,
        Range: "items=0-19",
      },
    });
    expect(res.statusCode).toBe(206);
  });

  it("without Range stays 200", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/project1/users?limit=2",
      headers: { Authorization: `Bearer ${readToken}` },
    });
    expect(res.statusCode).toBe(200);
  });
});
