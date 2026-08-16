/**
 * E-02 — OPTIONS /db/:database/:table
 *
 * PostgREST: Allow + Access-Control-Allow-Methods; no DB hit.
 * Auth skipped (CORS preflight has no Bearer).
 *
 * Refs:
 * - https://postgrest.org/en/stable/references/api/tables_views.html
 * - missing-endpoints.md E-02
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";

const JWT_SECRET = "test-secret-must-be-at-least-32-characters";
const ADMIN_SECRET = "test-admin-secret-16ch";

vi.stubEnv("JWT_SECRET", JWT_SECRET);
vi.stubEnv("ADMIN_SECRET", ADMIN_SECRET);

const unsafeCalls: { sql: string; params?: unknown[] }[] = [];

vi.mock("postgres", () => {
  const sqlMock = vi.fn(() => {
    const fn = vi.fn().mockResolvedValue([]) as unknown as Record<string, unknown>;
    fn.unsafe = vi.fn().mockImplementation((sql: string, params?: unknown[]) => {
      unsafeCalls.push({ sql, params });
      return Promise.resolve([]);
    });
    fn.end = vi.fn().mockResolvedValue(undefined);
    fn.begin = vi.fn().mockImplementation((_mode: string, cb: (sql: unknown) => unknown) => {
      const tx = {
        unsafe: vi.fn().mockImplementation((sql: string, params?: unknown[]) => {
          unsafeCalls.push({ sql, params });
          return Promise.resolve([]);
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
});

afterAll(async () => {
  await server.close();
  vi.unstubAllEnvs();
});

beforeEach(() => {
  unsafeCalls.length = 0;
});

describe("E-02 OPTIONS /db/:database/:table — contract", () => {
  it("200 Allow + Access-Control-Allow-Methods without auth", async () => {
    const res = await server.inject({
      method: "OPTIONS",
      url: "/db/project1/users",
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe("");
    expect(res.headers["allow"]).toBe("GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS");
    expect(res.headers["access-control-allow-methods"]).toBe(
      "GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS"
    );
    expect(String(res.headers["access-control-allow-headers"] ?? "")).toMatch(/Prefer/i);
    expect(unsafeCalls.length).toBe(0);
  });

  it("400 evil table name (no SQL)", async () => {
    const res = await server.inject({
      method: "OPTIONS",
      url: `/db/project1/${encodeURIComponent("users;DROP")}`,
    });
    expect(res.statusCode).toBe(400);
    expect(unsafeCalls.length).toBe(0);
  });
});
