/**
 * DB metadata route testleri.
 * GET /db/:database/size  — disk boyutu
 * GET /db/:database/stats — tablo istatistikleri
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

const MOCK_SIZE = { size_bytes: 8192000, size_human: "8000 kB" };
const MOCK_TABLES = [
  {
    name: "users",
    estimated_row_count: 100,
    total_size: "16 kB",
    table_size: "8 kB",
    index_size: "8 kB",
  },
];

vi.mock("postgres", () => {
  const sqlMock = vi.fn(() => {
    const fn = vi.fn().mockResolvedValue([MOCK_SIZE]) as unknown as Record<string, unknown>;
    fn.unsafe = vi.fn().mockResolvedValue(MOCK_TABLES);
    fn.end = vi.fn().mockResolvedValue(undefined);
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
let adminToken: string;
let dbToken: string;

beforeAll(async () => {
  server = Fastify({ logger: false });

  const { PoolManager } = await import("../../src/services/poolManager.js");
  const { CacheService } = await import("../../src/services/cacheService.js");

  server.decorate("poolManager", new PoolManager({} as never));
  server.decorate("cache", new CacheService());
  server.decorateRequest("user", null);
  server.decorateRequest("dbName", null);

  const jwtSvc = new JwtService(JWT_SECRET);

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

  const { dbRoutes } = await import("../../src/routes/db/index.js");
  await server.register(dbRoutes, { prefix: "/db" });
  await server.ready();

  adminToken = await jwtSvc.signAdminToken();
  dbToken = await jwtSvc.signDbToken("project1", ["read"]);
});

afterAll(async () => {
  await server.close();
  vi.unstubAllEnvs();
});

describe("GET /db/:database/size", () => {
  it("admin token ile DB boyutunu döner", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/db/project1/size",
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty("size_bytes");
    expect(body).toHaveProperty("size_human");
  });

  it("DB token (read scope) ile 200 döner", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/db/project1/size",
      headers: { Authorization: `Bearer ${dbToken}` },
    });
    expect(res.statusCode).toBe(200);
  });

  it("token olmadan 401 döner", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/db/project1/size",
    });
    expect(res.statusCode).toBe(401);
  });

  it("geçersiz DB adı 400 döner", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/db/123invalid/size",
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("GET /db/:database/stats", () => {
  it("admin token ile tablo istatistiklerini döner", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/db/project1/stats",
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty("database", "project1");
    expect(Array.isArray(body.tables)).toBe(true);
  });

  it("token olmadan 401 döner", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/db/project1/stats",
    });
    expect(res.statusCode).toBe(401);
  });
});