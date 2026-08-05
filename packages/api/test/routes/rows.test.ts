/**
 * Row CRUD endpoint testleri.
 * postgres.js ve cache mock'lanır.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { JwtService } from "../../src/services/jwtService.js";

const JWT_SECRET = "test-secret-must-be-at-least-32-characters";
const ADMIN_SECRET = "test-admin-secret-16ch";

vi.stubEnv("JWT_SECRET", JWT_SECRET);
vi.stubEnv("ADMIN_SECRET", ADMIN_SECRET);

// Mock veri
const MOCK_ROWS = [
  { id: 1, name: "Alice", email: "alice@example.com" },
  { id: 2, name: "Bob", email: "bob@example.com" },
];

// postgres mock
vi.mock("postgres", () => {
  const sqlMock = vi.fn(() => {
    const fn = vi.fn().mockResolvedValue(MOCK_ROWS) as unknown as Record<string, unknown>;
    fn.unsafe = vi.fn().mockResolvedValue(MOCK_ROWS);
    fn.end = vi.fn().mockResolvedValue(undefined);
    // begin("read only", cb) — rows GET handler'ı count+rows için kullanıyor
    fn.begin = vi.fn().mockImplementation((_mode: string, cb: (sql: unknown) => unknown) => {
      const txFn = vi.fn().mockResolvedValue(MOCK_ROWS) as unknown as Record<string, unknown>;
      txFn.unsafe = vi.fn()
        .mockResolvedValueOnce(MOCK_ROWS)           // rows
        .mockResolvedValueOnce([{ total: "2" }]);   // count
      return cb(txFn);
    });
    return fn;
  });
  return { default: sqlMock };
});

vi.mock("../../src/services/cacheService.js", () => ({
  CacheService: vi.fn().mockImplementation(() => ({
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    get: vi.fn().mockResolvedValue(null), // cache miss — her zaman DB'ye git
    set: vi.fn().mockResolvedValue(undefined),
    del: vi.fn().mockResolvedValue(undefined),
    invalidatePattern: vi.fn().mockResolvedValue(undefined),
    buildKey: (...p: string[]) => `postgrify:${p.join(":")}`,
  })),
  TTL: { ROW_QUERY: 30, SCHEMA: 300, TABLE_LIST: 120, DB_SIZE: 60 },
}));

let server: FastifyInstance;
let adminToken: string;
let dbToken: string;

beforeAll(async () => {
  server = Fastify({ logger: false });

  // Pluginleri manuel kur
  const { PoolManager } = await import("../../src/services/poolManager.js");
  const { CacheService } = await import("../../src/services/cacheService.js");

  server.decorate("poolManager", new PoolManager({} as never));
  server.decorate("cache", new CacheService());
  server.decorateRequest("user", null);
  server.decorateRequest("dbName", null);

  // Auth decorator'ları (gerçek JWT doğrulama)
  const { JwtService: Jwt } = await import("../../src/services/jwtService.js");
  const jwtSvc = new Jwt(JWT_SECRET);

  server.decorate("authenticate", async (req: never, reply: never) => {
    const auth = (req as { headers: Record<string, string> }).headers.authorization;
    if (!auth?.startsWith("Bearer ")) {
      return (reply as { status: (n: number) => { send: (b: unknown) => void } })
        .status(401).send({ error: "Unauthorized" });
    }
    const payload = await jwtSvc.verify(auth.slice(7));
    if (!payload) return (reply as { status: (n: number) => { send: (b: unknown) => void } })
      .status(401).send({ error: "Invalid token" });
    (req as { user: unknown }).user = payload;
  });

  server.decorate("authenticateAdmin", async () => {});

  const { dbRoutes } = await import("../../src/routes/db/index.js");
  await server.register(dbRoutes, { prefix: "/db" });
  await server.ready();

  // Token'ları üret
  const jwtSvcDirect = new JwtService(JWT_SECRET);
  adminToken = await jwtSvcDirect.signAdminToken();
  dbToken = await jwtSvcDirect.signDbToken("project1", ["read", "write", "delete"]);
});

afterAll(async () => {
  await server.close();
  vi.unstubAllEnvs();
});

describe("GET /db/:database/:table", () => {
  it("admin token ile 200 döner", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/db/project1/users",
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.rows)).toBe(true);
  });

  it("token olmadan 401 döner", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/db/project1/users",
    });
    expect(res.statusCode).toBe(401);
  });

  it("geçersiz tablo adı 400 döner", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/db/project1/123invalid",
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("POST /db/:database/:table", () => {
  it("write scope ile satır ekler", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/db/project1/users",
      headers: { Authorization: `Bearer ${dbToken}` },
      payload: { name: "Charlie", email: "charlie@example.com" },
    });
    expect(res.statusCode).toBe(201);
  });
});

describe("PATCH /db/:database/:table — toplu güncelleme", () => {
  it("where filtresi olmadan 400 döner", async () => {
    const res = await server.inject({
      method: "PATCH",
      url: "/db/project1/users",
      headers: { Authorization: `Bearer ${dbToken}` },
      payload: { name: "Updated" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/where filter required/i);
  });

  it("where filtresi ile 200 döner", async () => {
    const res = await server.inject({
      method: "PATCH",
      url: "/db/project1/users?where=id.eq.1",
      headers: { Authorization: `Bearer ${dbToken}` },
      payload: { name: "Updated" },
    });
    expect(res.statusCode).toBe(200);
  });

  it("token olmadan 401 döner", async () => {
    const res = await server.inject({
      method: "PATCH",
      url: "/db/project1/users?where=id.eq.1",
      payload: { name: "x" },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe("DELETE /db/:database/:table — toplu silme", () => {
  it("where filtresi olmadan 400 döner", async () => {
    const res = await server.inject({
      method: "DELETE",
      url: "/db/project1/users",
      headers: { Authorization: `Bearer ${dbToken}` },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/where filter required/i);
  });

  it("where filtresi ile 200 döner", async () => {
    const res = await server.inject({
      method: "DELETE",
      url: "/db/project1/users?where=id.eq.1",
      headers: { Authorization: `Bearer ${dbToken}` },
    });
    expect(res.statusCode).toBe(200);
  });

  it("delete scope olmadan 403 döner", async () => {
    const jwtSvcDirect = new JwtService(JWT_SECRET);
    const readOnlyToken = await jwtSvcDirect.signDbToken("project1", ["read"]);
    const res = await server.inject({
      method: "DELETE",
      url: "/db/project1/users?where=id.eq.1",
      headers: { Authorization: `Bearer ${readOnlyToken}` },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("GET /db/:database/:table — read-only transaction", () => {
  it("begin 'read only' transaction ile çağrılır", async () => {
    const { default: postgres } = await import("postgres");
    const ctor = postgres as ReturnType<typeof vi.fn>;
    // Mock factory'nin döndürdüğü sql fn'ini bul
    const sqlFn = ctor.mock.results[ctor.mock.results.length - 1]?.value;

    await server.inject({
      method: "GET",
      url: "/db/project1/users",
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    expect(sqlFn?.begin).toHaveBeenCalledWith("read only", expect.any(Function));
  });
});