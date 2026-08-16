/**
 * E-09 / E-10 RPC endpoint tests.
 */

import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { JwtService } from "../../src/services/jwtService.js";

const JWT_SECRET = "test-secret-must-be-at-least-32-characters";

vi.stubEnv("JWT_SECRET", JWT_SECRET);

let sqlFnRef: ReturnType<typeof vi.fn> & {
  unsafe: ReturnType<typeof vi.fn>;
};

vi.mock("postgres", () => {
  const sqlFn = vi.fn().mockResolvedValue([{ "?column?": 1 }]);
  sqlFn.unsafe = vi.fn().mockResolvedValue([{ id: 1, name: "Ali" }]);
  sqlFn.end = vi.fn().mockResolvedValue(undefined);
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
    buildKey: (...p: string[]) => p.join(":"),
  })),
  TTL: { ROW_QUERY: 30, SCHEMA: 300, TABLE_LIST: 120, DB_SIZE: 60 },
}));

let server: FastifyInstance;
let adminToken: string;
let queryToken: string;
let readOnlyToken: string;

beforeAll(async () => {
  const jwtSvc = new JwtService(JWT_SECRET);
  adminToken = await jwtSvc.signAdminToken();
  queryToken = await jwtSvc.signDbToken("testdb", ["query", "read"]);
  readOnlyToken = await jwtSvc.signDbToken("testdb", ["read"]);

  server = Fastify({ logger: false });
  const { PoolManager } = await import("../../src/services/poolManager.js");
  const { CacheService } = await import("../../src/services/cacheService.js");
  const { default: postgres } = await import("postgres");
  sqlFnRef = (postgres as unknown as ReturnType<typeof vi.fn>)() as typeof sqlFnRef;

  server.decorate("poolManager", new PoolManager({} as never));
  server.decorate("cache", new CacheService());
  server.decorateRequest("user", null);
  server.decorateRequest("dbName", null);
  server.decorateRequest("dbUser", null);

  server.decorate("authenticate", async (req: FastifyRequest, reply: FastifyReply) => {
    const auth = req.headers.authorization;
    if (!auth?.startsWith("Bearer ")) return reply.status(401).send({ error: "Unauthorized" });
    const payload = await jwtSvc.verifyAdminOrDb(auth.slice(7));
    if (!payload) return reply.status(401).send({ error: "Invalid token" });
    req.user = payload;
    if (!req.dbName) req.dbName = (req.params as Record<string, string>)?.database;
  });
  server.decorate("authenticateAny", async (req: FastifyRequest, reply: FastifyReply) => {
    return server.authenticate(req, reply);
  });
  server.decorate("authenticateAdmin", async () => {});
  server.decorate("jwtService", jwtSvc);

  const { rpcRoute } = await import("../../src/routes/db/rpc.js");
  await server.register(async (s) => {
    s.addHook("preHandler", async (req, reply) => {
      if (req.method === "OPTIONS") return;
      return s.authenticateAny(req, reply);
    });
    s.addHook("preHandler", async (req) => {
      req.dbName = (req.params as Record<string, string>)?.database ?? "testdb";
    });
    await s.register(rpcRoute);
  });
  await server.ready();
});

afterAll(async () => {
  await server.close();
});

beforeEach(() => {
  vi.clearAllMocks();
  // resolvePublicFunction → provolatile stable by default
  sqlFnRef.mockResolvedValue([{ provolatile: "s" }]);
  sqlFnRef.unsafe = vi.fn().mockResolvedValue([{ id: 1, name: "Ali" }]);
});

describe("GET /:database/rpc/:function (E-09)", () => {
  it("named query args → 200 rows", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/testdb/rpc/get_active_users?min_age=18&role=admin",
      headers: { authorization: `Bearer ${queryToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([{ id: 1, name: "Ali" }]);
    const sql = (sqlFnRef.unsafe as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(sql).toContain('"get_active_users"');
    expect(sql).toContain('"min_age" :=');
    expect(sql).toContain('"role" :=');
  });

  it("missing function → 404", async () => {
    sqlFnRef.mockResolvedValue([]);
    const res = await server.inject({
      method: "GET",
      url: "/testdb/rpc/nope",
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it("query scope required → 403 without query", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/testdb/rpc/get_active_users",
      headers: { authorization: `Bearer ${readOnlyToken}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it("scalar unwrap when single column", async () => {
    sqlFnRef.unsafe = vi.fn().mockResolvedValue([{ get_count: 42 }]);
    const res = await server.inject({
      method: "GET",
      url: "/testdb/rpc/get_count",
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toBe(42);
  });

  it("GET VOLATILE → 405", async () => {
    sqlFnRef.mockResolvedValue([{ provolatile: "v" }]);
    const res = await server.inject({
      method: "GET",
      url: "/testdb/rpc/do_side_effect",
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(405);
    expect(res.json().message).toMatch(/VOLATILE/i);
  });

  it("invalid arg type → 400 not 500", async () => {
    sqlFnRef.mockResolvedValue([{ provolatile: "s" }]);
    sqlFnRef.unsafe = vi
      .fn()
      .mockRejectedValue(new Error('invalid input syntax for type integer: "abc"'));
    const res = await server.inject({
      method: "GET",
      url: "/testdb/rpc/smoke_add?a=abc&b=1",
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("POST /:database/rpc/:function (E-10)", () => {
  it("JSON body named args", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/testdb/rpc/create_order",
      headers: {
        authorization: `Bearer ${queryToken}`,
        "content-type": "application/json",
      },
      payload: { customer_id: 1, total: 99.9 },
    });

    expect(res.statusCode).toBe(200);
    const sql = (sqlFnRef.unsafe as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(sql).toContain('"create_order"');
    expect(sql).toContain('"customer_id" :=');
  });

  it("Prefer: params=single-object → jsonb arg", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/testdb/rpc/ingest",
      headers: {
        authorization: `Bearer ${adminToken}`,
        prefer: "params=single-object",
        "content-type": "application/json",
      },
      payload: { a: 1, b: 2 },
    });

    expect(res.statusCode).toBe(200);
    const call = (sqlFnRef.unsafe as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toContain("$1::jsonb");
    expect(call[1][0]).toBe(JSON.stringify({ a: 1, b: 2 }));
  });

  it("Prefer: return=minimal → 204", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/testdb/rpc/do_void",
      headers: {
        authorization: `Bearer ${adminToken}`,
        prefer: "return=minimal",
        "content-type": "application/json",
      },
      payload: {},
    });
    expect(res.statusCode).toBe(204);
  });

  it("POST VOLATILE allowed", async () => {
    sqlFnRef.mockResolvedValue([{ provolatile: "v" }]);
    sqlFnRef.unsafe = vi.fn().mockResolvedValue([{ smoke_touch: "touched" }]);
    const res = await server.inject({
      method: "POST",
      url: "/testdb/rpc/do_side_effect",
      headers: {
        authorization: `Bearer ${adminToken}`,
        "content-type": "application/json",
      },
      payload: {},
    });
    expect(res.statusCode).toBe(200);
  });
});

describe("OPTIONS /:database/rpc/:function", () => {
  it("Allow header includes GET, POST", async () => {
    const res = await server.inject({
      method: "OPTIONS",
      url: "/testdb/rpc/anything",
    });
    expect(res.statusCode).toBe(204);
    expect(res.headers.allow).toMatch(/GET/);
    expect(res.headers.allow).toMatch(/POST/);
  });
});
