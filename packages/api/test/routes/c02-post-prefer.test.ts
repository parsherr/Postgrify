/**
 * C-02 — POST /db/:database/:table Prefer: return / resolution / missing
 *
 * Refs:
 * - https://docs.postgrest.org/en/stable/references/api/preferences.html
 * - https://docs.postgrest.org/en/latest/references/api/tables_views.html
 * - should-corrected-endpoints.md C-02
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { JwtService } from "../../src/services/jwtService.js";

const JWT_SECRET = "test-secret-must-be-at-least-32-characters";
const ADMIN_SECRET = "test-admin-secret-16ch";

vi.stubEnv("JWT_SECRET", JWT_SECRET);
vi.stubEnv("ADMIN_SECRET", ADMIN_SECRET);

const MOCK_INSERTED = [{ id: 1, name: "Alice", email: "a@x.com" }];
const unsafeCalls: { sql: string; params?: unknown[] }[] = [];

vi.mock("postgres", () => {
  const sqlMock = vi.fn(() => {
    const fn = vi.fn().mockResolvedValue(MOCK_INSERTED) as unknown as Record<string, unknown>;
    fn.unsafe = vi.fn().mockImplementation((sql: string, params?: unknown[]) => {
      unsafeCalls.push({ sql, params });
      return Promise.resolve(MOCK_INSERTED);
    });
    fn.end = vi.fn().mockResolvedValue(undefined);
    fn.begin = vi.fn().mockImplementation((_m: string, cb: (t: unknown) => unknown) => {
      const tx = { unsafe: fn.unsafe };
      return cb(tx);
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
  writeToken = await jwt.signDbToken("project1", ["write"]);
  readToken = await jwt.signDbToken("project1", ["read"]);
});

afterAll(async () => {
  await server.close();
  vi.unstubAllEnvs();
});

beforeEach(() => {
  unsafeCalls.length = 0;
});

describe("C-02 POST Prefer: return", () => {
  it("default return=minimal → 201 empty body (no {inserted})", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/db/project1/users",
      headers: { Authorization: `Bearer ${writeToken}` },
      payload: { name: "Alice", email: "a@x.com" },
    });
    expect(res.statusCode).toBe(201);
    expect(res.body).toBe("");
    expect(unsafeCalls[0].sql).not.toMatch(/RETURNING/i);
  });

  it("Prefer: return=representation → 201 + array", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/db/project1/users",
      headers: {
        Authorization: `Bearer ${writeToken}`,
        Prefer: "return=representation",
      },
      payload: { name: "Alice", email: "a@x.com" },
    });
    expect(res.statusCode).toBe(201);
    expect(Array.isArray(res.json())).toBe(true);
    expect(res.json()).toEqual(MOCK_INSERTED);
    expect(unsafeCalls[0].sql).toMatch(/RETURNING \*/i);
    expect(res.headers["preference-applied"]).toMatch(/return=representation/);
  });

  it("Prefer: return=headers-only → Location, empty body", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/db/project1/users",
      headers: {
        Authorization: `Bearer ${writeToken}`,
        Prefer: "return=headers-only",
      },
      payload: { name: "Alice" },
    });
    expect(res.statusCode).toBe(201);
    expect(res.body).toBe("");
    expect(res.headers.location).toMatch(/\/db\/project1\/users/);
  });

  it("bulk body is still an array under representation", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/db/project1/users",
      headers: {
        Authorization: `Bearer ${writeToken}`,
        Prefer: "return=representation",
      },
      payload: [{ name: "A" }, { name: "B" }],
    });
    expect(res.statusCode).toBe(201);
    expect(Array.isArray(res.json())).toBe(true);
    expect(unsafeCalls[0].sql).toMatch(/VALUES/);
  });
});

describe("C-02 POST Prefer: resolution + on_conflict", () => {
  it("resolution without on_conflict → 400", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/db/project1/users",
      headers: {
        Authorization: `Bearer ${writeToken}`,
        Prefer: "resolution=merge-duplicates",
      },
      payload: { email: "a@x.com", name: "A" },
    });
    expect(res.statusCode).toBe(400);
    expect(unsafeCalls.length).toBe(0);
  });

  it("merge-duplicates → ON CONFLICT DO UPDATE, status 200", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/db/project1/users?on_conflict=email",
      headers: {
        Authorization: `Bearer ${writeToken}`,
        Prefer: "resolution=merge-duplicates,return=representation",
      },
      payload: { email: "a@x.com", name: "A2" },
    });
    expect(res.statusCode).toBe(200);
    expect(unsafeCalls[0].sql).toMatch(/ON CONFLICT \("email"\) DO UPDATE/i);
  });

  it("ignore-duplicates → ON CONFLICT DO NOTHING", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/db/project1/users?on_conflict=email",
      headers: {
        Authorization: `Bearer ${writeToken}`,
        Prefer: "resolution=ignore-duplicates",
      },
      payload: { email: "a@x.com", name: "A" },
    });
    expect(res.statusCode).toBe(200);
    expect(unsafeCalls[0].sql).toMatch(/ON CONFLICT \("email"\) DO NOTHING/i);
  });

  it("rejects evil on_conflict identifier", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/db/project1/users?on_conflict=email);drop",
      headers: {
        Authorization: `Bearer ${writeToken}`,
        Prefer: "resolution=merge-duplicates",
      },
      payload: { email: "a@x.com" },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("C-02 POST Prefer: missing + columns", () => {
  it("columns= whitelist drops extra keys", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/db/project1/users?columns=name,email",
      headers: {
        Authorization: `Bearer ${writeToken}`,
        Prefer: "return=representation",
      },
      payload: { name: "A", email: "a@x.com", evil: "x" },
    });
    expect(res.statusCode).toBe(201);
    const sql = unsafeCalls[0].sql;
    expect(sql).toMatch(/"name"/);
    expect(sql).toMatch(/"email"/);
    expect(sql).not.toMatch(/"evil"/);
  });

  it("missing=default omits absent columns from INSERT list", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/db/project1/products?columns=name,price",
      headers: {
        Authorization: `Bearer ${writeToken}`,
        Prefer: "missing=default,return=representation",
      },
      payload: { name: "Widget" },
    });
    expect(res.statusCode).toBe(201);
    expect(unsafeCalls[0].sql).toMatch(/\("name"\)/);
    expect(unsafeCalls[0].sql).not.toMatch(/"price"/);
  });
});

describe("C-02 POST security", () => {
  it("401 without token", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/db/project1/users",
      payload: { name: "x" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("403 read-only token", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/db/project1/users",
      headers: { Authorization: `Bearer ${readToken}` },
      payload: { name: "x" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("400 evil column name", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/db/project1/users",
      headers: { Authorization: `Bearer ${writeToken}` },
      payload: { "name;drop": "x" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("values are bind params not concatenated", async () => {
    const evil = "'); DROP TABLE users;--";
    const res = await server.inject({
      method: "POST",
      url: "/db/project1/users",
      headers: {
        Authorization: `Bearer ${writeToken}`,
        Prefer: "return=representation",
      },
      payload: { name: evil },
    });
    expect(res.statusCode).toBe(201);
    expect(unsafeCalls[0].sql).toMatch(/\$1/);
    expect(unsafeCalls[0].sql).not.toMatch(/DROP TABLE/);
    expect(unsafeCalls[0].params?.[0]).toBe(evil);
  });
});
