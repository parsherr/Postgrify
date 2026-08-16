/**
 * C-05 PUT /:id upsert + Prefer · C-06 GET /:id ?select=
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { JwtService } from "../../src/services/jwtService.js";

const JWT_SECRET = "test-secret-must-be-at-least-32-characters";
vi.stubEnv("JWT_SECRET", JWT_SECRET);
vi.stubEnv("ADMIN_SECRET", "test-admin-secret-16ch");

const MOCK_ROW = { id: 42, name: "Ali", email: "a@x.com" };
const unsafeCalls: { sql: string; params?: unknown[] }[] = [];

vi.mock("postgres", () => {
  const sqlMock = vi.fn(() => {
    const fn = vi.fn().mockResolvedValue([MOCK_ROW]) as unknown as Record<string, unknown>;
    fn.unsafe = vi.fn().mockImplementation((sql: string, params?: unknown[]) => {
      unsafeCalls.push({ sql, params });
      if (/UPDATE/i.test(sql) && /WHERE/i.test(sql)) {
        // Simulate miss then insert path: first UPDATE returns []
        if (unsafeCalls.filter((c) => /UPDATE/i.test(c.sql)).length === 1 && params?.[0] === "missing") {
          return Promise.resolve([]);
        }
      }
      return Promise.resolve([MOCK_ROW]);
    });
    fn.end = vi.fn().mockResolvedValue(undefined);
    fn.begin = vi.fn().mockImplementation((_m: string, cb: (t: unknown) => unknown) =>
      cb({ unsafe: fn.unsafe })
    );
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

let server: FastifyInstance;
let writeToken: string;
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
  const { dbRoutes } = await import("../../src/routes/db/index.js");
  await server.register(dbRoutes, { prefix: "/db" });
  await server.ready();
  const jwt = new JwtService(JWT_SECRET);
  writeToken = await jwt.signDbToken("project1", ["write", "read"]);
  readToken = await jwt.signDbToken("project1", ["read"]);
});

afterAll(async () => {
  await server.close();
  vi.unstubAllEnvs();
});

beforeEach(() => {
  unsafeCalls.length = 0;
});

describe("C-06 GET /:id ?select=", () => {
  it("default SELECT * returns object", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/db/project1/users/42",
      headers: { Authorization: `Bearer ${readToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(MOCK_ROW);
    expect(unsafeCalls[0].sql).toMatch(/SELECT \*/);
  });

  it("?select=id,name limits columns", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/db/project1/users/42?select=id,name",
      headers: { Authorization: `Bearer ${readToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(unsafeCalls[0].sql).toMatch(/SELECT "id", "name"/);
  });

  it("evil select → 400", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/db/project1/users/42?select=id);drop",
      headers: { Authorization: `Bearer ${readToken}` },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("C-05 PUT /:id Prefer + upsert", () => {
  it("no Prefer → 200 + row body (compat)", async () => {
    const res = await server.inject({
      method: "PUT",
      url: "/db/project1/users/42",
      headers: { Authorization: `Bearer ${writeToken}` },
      payload: { name: "Ali Updated" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(MOCK_ROW);
  });

  it("Prefer: return=minimal → 204", async () => {
    const res = await server.inject({
      method: "PUT",
      url: "/db/project1/users/42",
      headers: {
        Authorization: `Bearer ${writeToken}`,
        Prefer: "return=minimal",
      },
      payload: { name: "x" },
    });
    expect(res.statusCode).toBe(204);
    expect(res.body).toBe("");
  });

  it("missing row → INSERT upsert → 201", async () => {
    const res = await server.inject({
      method: "PUT",
      url: "/db/project1/users/missing",
      headers: {
        Authorization: `Bearer ${writeToken}`,
        Prefer: "return=representation",
      },
      payload: { name: "New" },
    });
    expect(res.statusCode).toBe(201);
    expect(unsafeCalls.some((c) => /INSERT INTO/i.test(c.sql))).toBe(true);
  });

  it("evil column → 400", async () => {
    const res = await server.inject({
      method: "PUT",
      url: "/db/project1/users/1",
      headers: { Authorization: `Bearer ${writeToken}` },
      payload: { "x;drop": 1 },
    });
    expect(res.statusCode).toBe(400);
  });
});
