/**
 * Tablo yönetim endpoint testleri.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { JwtService } from "../../src/services/jwtService.js";

const JWT_SECRET = "test-secret-must-be-at-least-32-characters";

vi.stubEnv("JWT_SECRET", JWT_SECRET);
vi.stubEnv("ADMIN_SECRET", "test-admin-secret-16ch");

const MOCK_TABLES = [
  { name: "users", estimated_row_count: 100, size: "16 kB" },
  { name: "posts", estimated_row_count: 500, size: "64 kB" },
];

const MOCK_SCHEMA = {
  table: "users",
  columns: [
    { name: "id", type: "integer", nullable: "NO", default: null, primary_key: true },
    { name: "name", type: "text", nullable: "NO", default: null, primary_key: false },
  ],
};

vi.mock("postgres", () => {
  const sqlFn = vi.fn((strings: TemplateStringsArray) => {
    // tablo listesi sorgusu
    if (strings?.[0]?.includes("information_schema.tables")) return Promise.resolve(MOCK_TABLES);
    // şema sorgusu
    if (strings?.[0]?.includes("information_schema.columns")) return Promise.resolve(MOCK_SCHEMA.columns);
    return Promise.resolve([]);
  }) as unknown as Record<string, unknown>;
  sqlFn.unsafe = vi.fn().mockResolvedValue([]);
  sqlFn.end = vi.fn().mockResolvedValue(undefined);
  const ctor = vi.fn(() => sqlFn);
  return { default: ctor };
});

vi.mock("../../src/services/cacheService.js", () => ({
  CacheService: vi.fn().mockImplementation(() => ({
    connect: vi.fn(), disconnect: vi.fn(),
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn(), del: vi.fn(), invalidatePattern: vi.fn(),
    buildKey: (...p: string[]) => `postgrify:${p.join(":")}`,
    redisClient: null,
  })),
  TTL: { ROW_QUERY: 30, SCHEMA: 300, TABLE_LIST: 120, DB_SIZE: 60 },
}));

let server: FastifyInstance;
let adminToken: string;
let schemaToken: string;
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
  schemaToken = await jwtSvcDirect.signDbToken("project1", ["read", "schema"]);
  readToken = await jwtSvcDirect.signDbToken("project1", ["read"]);
});

afterAll(async () => {
  await server.close();
  vi.unstubAllEnvs();
});

describe("GET /db/:database/tables", () => {
  it("tablo listesini döner", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/db/project1/tables",
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(200);
  });
});

describe("POST /db/:database/tables", () => {
  it("schema scope ile tablo oluşturur", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/db/project1/tables",
      headers: { Authorization: `Bearer ${schemaToken}` },
      payload: {
        name: "products",
        columns: [
          { name: "id", type: "serial", primaryKey: true },
          { name: "title", type: "text", nullable: false },
        ],
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().name).toBe("products");
  });

  it("schema scope olmadan 403 döner", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/db/project1/tables",
      headers: { Authorization: `Bearer ${readToken}` },
      payload: { name: "test", columns: [{ name: "id", type: "serial" }] },
    });
    expect(res.statusCode).toBe(403);
  });

  it("geçersiz tablo adı 400 döner", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/db/project1/tables",
      headers: { Authorization: `Bearer ${schemaToken}` },
      payload: { name: "123bad!", columns: [{ name: "id", type: "serial" }] },
    });
    expect(res.statusCode).toBe(400);
  });

  it("geçersiz col.type injection reddedilir — 400", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/db/project1/tables",
      headers: { Authorization: `Bearer ${schemaToken}` },
      payload: {
        name: "hacked",
        columns: [{ name: "x", type: "TEXT; DROP TABLE users" }],
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("geçersiz col.type 'VOID' reddedilir — 400", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/db/project1/tables",
      headers: { Authorization: `Bearer ${schemaToken}` },
      payload: {
        name: "hacked",
        columns: [{ name: "x", type: "VOID" }],
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("'VARCHAR(255)' parantezli tip geçer — 201", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/db/project1/tables",
      headers: { Authorization: `Bearer ${schemaToken}` },
      payload: {
        name: "products",
        columns: [
          { name: "id", type: "serial", primaryKey: true },
          { name: "title", type: "VARCHAR(255)", nullable: false },
        ],
      },
    });
    expect(res.statusCode).toBe(201);
  });

  it("col.default injection 'now()); DROP TABLE users; --' reddedilir — 400", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/db/project1/tables",
      headers: { Authorization: `Bearer ${schemaToken}` },
      payload: {
        name: "evil",
        columns: [
          { name: "ts", type: "TIMESTAMPTZ", default: "now()); DROP TABLE users; --" },
        ],
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("col.default 'now()' geçer — 201", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/db/project1/tables",
      headers: { Authorization: `Bearer ${schemaToken}` },
      payload: {
        name: "events",
        columns: [
          { name: "id", type: "serial", primaryKey: true },
          { name: "created_at", type: "TIMESTAMPTZ", default: "now()" },
        ],
      },
    });
    expect(res.statusCode).toBe(201);
  });

  it("col.default \"'active'\" quoted string geçer — 201", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/db/project1/tables",
      headers: { Authorization: `Bearer ${schemaToken}` },
      payload: {
        name: "items",
        columns: [
          { name: "id", type: "serial", primaryKey: true },
          { name: "status", type: "TEXT", default: "'active'" },
        ],
      },
    });
    expect(res.statusCode).toBe(201);
  });

  it("col.default tırnak injection reddedilir — 400", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/db/project1/tables",
      headers: { Authorization: `Bearer ${schemaToken}` },
      payload: {
        name: "evil2",
        columns: [
          { name: "x", type: "TEXT", default: "'; DROP TABLE users; --'" },
        ],
      },
    });
    expect(res.statusCode).toBe(400);
  });
});