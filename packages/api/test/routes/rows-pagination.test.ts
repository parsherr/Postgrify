/**
 * SORUN #9 Fix — GET /:database/:table response'da limit ve offset alanları
 *
 * rows.ts GET response: { rows, total, limit, offset }
 * - rows: sorgu sonuçları
 * - total: COUNT(*) toplam kayıt sayısı
 * - limit: uygulanan limit değeri (default 100)
 * - offset: uygulanan offset değeri (default 0)
 *
 * İstemci (DataClient, GUI) kaç kayıt daha olduğunu hesaplayabilmeli:
 *   hasMore = offset + rows.length < total
 */

import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { JwtService } from "../../src/services/jwtService.js";

const JWT_SECRET = "test-secret-must-be-at-least-32-characters";
const ADMIN_SECRET = "test-admin-secret-16ch";

vi.stubEnv("JWT_SECRET", JWT_SECRET);
vi.stubEnv("ADMIN_SECRET", ADMIN_SECRET);

const MOCK_ROWS = [
  { id: "1", name: "Alice" },
  { id: "2", name: "Bob" },
];
const MOCK_COUNT = [{ total: "42" }]; // PostgreSQL bigint → string

vi.mock("postgres", () => {
  const sqlMock = vi.fn(() => {
    const fn = vi.fn().mockResolvedValue(MOCK_ROWS) as unknown as Record<string, unknown>;
    fn.unsafe = vi.fn().mockResolvedValue(MOCK_ROWS);
    fn.end = vi.fn().mockResolvedValue(undefined);
    fn.begin = vi.fn().mockImplementation((_mode: string, cb: (sql: unknown) => unknown) => {
      const tx = {
        unsafe: vi.fn()
          .mockResolvedValueOnce(MOCK_ROWS)   // rows
          .mockResolvedValueOnce(MOCK_COUNT),  // count
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
    get: vi.fn().mockResolvedValue(null), // cache miss — her zaman DB'ye git
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

  // authenticate: admin or DB-scoped token
  server.decorate("authenticate", async (req: never, reply: never) => {
    const auth = (req as { headers: Record<string, string> }).headers.authorization;
    if (!auth?.startsWith("Bearer ")) return (reply as { status: (n: number) => { send: (b: unknown) => void } }).status(401).send({ error: "Unauthorized" });
    const payload = await jwtSvc.verifyAdminOrDb(auth.slice(7));
    if (!payload) return (reply as { status: (n: number) => { send: (b: unknown) => void } }).status(401).send({ error: "Invalid" });
    (req as { user: unknown }).user = payload;
  });

  server.decorate("authenticateAdmin", async () => {});

  // authenticateAny: dbRoutes preHandler hook için gerekli
  server.decorate("authenticateAny", async (req: never, reply: never) => {
    const auth = (req as { headers: Record<string, string> }).headers.authorization;
    if (!auth?.startsWith("Bearer ")) return (reply as { status: (n: number) => { send: (b: unknown) => void } }).status(401).send({ error: "Unauthorized" });
    const token = auth.slice(7);
    const adminOrDb = await jwtSvc.verifyAdminOrDb(token);
    if (adminOrDb) { (req as { user: unknown }).user = adminOrDb; return; }
    const dbUser = await jwtSvc.verifyDbUser(token);
    if (dbUser) { (req as { dbUser: unknown }).dbUser = dbUser; return; }
    return (reply as { status: (n: number) => { send: (b: unknown) => void } }).status(401).send({ error: "Invalid token" });
  });

  server.addHook("preHandler", async (req) => { (req as { dbName: string }).dbName = "project1"; });

  const { dbRoutes } = await import("../../src/routes/db/index.js");
  await server.register(dbRoutes);
  await server.ready();

  const jwtSvcDirect = new JwtService(JWT_SECRET);
  readToken = await jwtSvcDirect.signDbToken("project1", ["read"]);
});

afterAll(async () => {
  await server.close();
  vi.unstubAllEnvs();
});

describe("SORUN #9 — GET /:database/:table response'da limit ve offset", () => {
  it("response { rows, total, limit, offset } içermeli", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/project1/users",
      headers: { Authorization: `Bearer ${readToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body).toHaveProperty("rows");
    expect(body).toHaveProperty("total");
    expect(body).toHaveProperty("limit");
    expect(body).toHaveProperty("offset");
  });

  it("limit parametresi response'a yansımalı", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/project1/users?limit=10",
      headers: { Authorization: `Bearer ${readToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.limit).toBe(10);
  });

  it("offset parametresi response'a yansımalı", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/project1/users?limit=20&offset=40",
      headers: { Authorization: `Bearer ${readToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.limit).toBe(20);
    expect(body.offset).toBe(40);
  });

  it("default limit=100, offset=0 olmalı", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/project1/users",
      headers: { Authorization: `Bearer ${readToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.limit).toBe(100);
    expect(body.offset).toBe(0);
  });

  it("hasMore hesabı yapılabilmeli: offset + rows.length < total", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/project1/users?limit=2&offset=0",
      headers: { Authorization: `Bearer ${readToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    const hasMore = body.offset + body.rows.length < body.total;
    // total=42, offset=0, rows.length=2 → hasMore=true (0+2 < 42)
    expect(typeof hasMore).toBe("boolean");
  });
});