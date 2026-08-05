/**
 * Ham SQL sorgu endpoint testleri.
 * SELECT-only mod ve keyword blocklist doğrulanır.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { JwtService } from "../../src/services/jwtService.js";

const JWT_SECRET = "test-secret-must-be-at-least-32-characters";

vi.stubEnv("JWT_SECRET", JWT_SECRET);
vi.stubEnv("ADMIN_SECRET", "test-admin-secret-16ch");
vi.stubEnv("ALLOW_RAW_SQL_ADMIN", "true");

vi.mock("postgres", () => {
  const sqlFn = vi.fn().mockResolvedValue([{ count: 42 }]) as unknown as Record<string, unknown>;
  sqlFn.unsafe = vi.fn().mockResolvedValue([{ count: 42 }]);
  sqlFn.end = vi.fn().mockResolvedValue(undefined);
  // begin("read only", cb) — cb'yi mock sql ile çağırır
  sqlFn.begin = vi.fn().mockImplementation((_mode: string, cb: (sql: unknown) => unknown) => {
    return cb(sqlFn);
  });
  const ctor = vi.fn(() => sqlFn);
  return { default: ctor };
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

  server.decorate("authenticate", async (req: never, reply: never) => {
    const auth = (req as { headers: Record<string, string> }).headers.authorization;
    if (!auth?.startsWith("Bearer ")) return (reply as { status: (n: number) => { send: (b: unknown) => void } }).status(401).send({ error: "Unauthorized" });
    const payload = await jwtSvc.verify(auth.slice(7));
    if (!payload) return (reply as { status: (n: number) => { send: (b: unknown) => void } }).status(401).send({ error: "Invalid" });
    (req as { user: unknown }).user = payload;
  });
  server.decorate("authenticateAdmin", async () => {});

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

describe("POST /db/:database/query", () => {
  it("SELECT sorgusu başarılı", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/db/project1/query",
      headers: { Authorization: `Bearer ${queryToken}` },
      payload: { sql: "SELECT * FROM users LIMIT 10" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.rows)).toBe(true);
  });

  it("SELECT-only modda DROP reddedilir", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/db/project1/query",
      headers: { Authorization: `Bearer ${queryToken}` },
      payload: { sql: "DROP TABLE users" },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toMatch(/SELECT/);
  });

  it("WITH ile başlayan CTE geçer", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/db/project1/query",
      headers: { Authorization: `Bearer ${queryToken}` },
      payload: { sql: "WITH cte AS (SELECT 1) SELECT * FROM cte" },
    });
    expect(res.statusCode).toBe(200);
  });

  it("query scope olmadan 403 döner", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/db/project1/query",
      headers: { Authorization: `Bearer ${readOnlyToken}` },
      payload: { sql: "SELECT 1" },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().message).toMatch(/query/);
  });

  it("admin token ile DELETE çalıştırabilir (ALLOW_RAW_SQL_ADMIN=true)", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/db/project1/query",
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: { sql: "DELETE FROM users WHERE id = 999" },
    });
    // Admin tam SQL izni var, engellenmemeli
    expect(res.statusCode).toBe(200);
  });

  it("writeable CTE bypass: WITH x AS (DELETE...) SELECT reddedilir — 403", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/db/project1/query",
      headers: { Authorization: `Bearer ${queryToken}` },
      payload: { sql: "WITH x AS (DELETE FROM users WHERE id=1) SELECT 1" },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toMatch(/Writable CTE/i);
  });

  it("writeable CTE bypass: WITH x AS (INSERT...) SELECT reddedilir — 403", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/db/project1/query",
      headers: { Authorization: `Bearer ${queryToken}` },
      payload: { sql: "WITH x AS (INSERT INTO users VALUES(1)) SELECT 1" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("writeable CTE bypass: WITH x AS (UPDATE...) SELECT reddedilir — 403", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/db/project1/query",
      headers: { Authorization: `Bearer ${queryToken}` },
      payload: { sql: "WITH x AS (UPDATE users SET name='x') SELECT 1" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("read-only CTE WITH x AS (SELECT...) SELECT geçer — 200", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/db/project1/query",
      headers: { Authorization: `Bearer ${queryToken}` },
      payload: { sql: "WITH x AS (SELECT 1 AS n) SELECT * FROM x" },
    });
    expect(res.statusCode).toBe(200);
  });

  it("SELECT-only modda begin 'read only' transaction kullanılır", async () => {
    const { default: postgres } = await import("postgres");
    const sqlFn = (postgres as ReturnType<typeof vi.fn>).mock.results[0]?.value;

    await server.inject({
      method: "POST",
      url: "/db/project1/query",
      headers: { Authorization: `Bearer ${queryToken}` },
      payload: { sql: "SELECT 1" },
    });

    expect(sqlFn?.begin).toHaveBeenCalledWith(
      "read only",
      expect.any(Function)
    );
  });
});