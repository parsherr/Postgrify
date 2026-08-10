/**
 * SORUN #H Fix — DB user token (editor rolü) /query endpoint'ine erişebilmeli.
 *
 * query.ts preHandler: [server.authenticateAny, scopeGuard("query")]
 *   - authenticateAny: DB user token'larını req.dbUser'a set eder
 *   - scopeGuard("query"): editor rolü → query scope var ✓
 *
 * Eski hata: preHandler sadece [scopeGuard("query")] içeriyordu.
 * authenticateAny olmadan req.dbUser hiç set edilmiyordu → 403.
 */

import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { JwtService } from "../../src/services/jwtService.js";

const JWT_SECRET = "test-secret-must-be-at-least-32-characters";
const ADMIN_SECRET = "test-admin-secret-16ch";

vi.stubEnv("JWT_SECRET", JWT_SECRET);
vi.stubEnv("ADMIN_SECRET", ADMIN_SECRET);
vi.stubEnv("ALLOW_RAW_SQL_ADMIN", "false");
vi.stubEnv("QUERY_LOG_ENABLED", "false");

const MOCK_ROWS = [{ id: "1", content: "hello" }];

vi.mock("postgres", () => {
  const sqlMock = vi.fn(() => {
    const fn = vi.fn().mockResolvedValue(MOCK_ROWS) as unknown as Record<string, unknown>;
    fn.unsafe = vi.fn().mockResolvedValue(MOCK_ROWS);
    fn.end    = vi.fn().mockResolvedValue(undefined);
    fn.begin  = vi.fn().mockImplementation((_mode: string, cb: (sql: unknown) => unknown) =>
      cb({ unsafe: vi.fn().mockResolvedValue(MOCK_ROWS) })
    );
    return fn;
  });
  return { default: sqlMock };
});

vi.mock("../../src/services/cacheService.js", () => ({
  CacheService: vi.fn().mockImplementation(() => ({
    connect:           vi.fn().mockResolvedValue(undefined),
    disconnect:        vi.fn().mockResolvedValue(undefined),
    get:               vi.fn().mockResolvedValue(null),
    set:               vi.fn().mockResolvedValue(undefined),
    del:               vi.fn().mockResolvedValue(undefined),
    invalidatePattern: vi.fn().mockResolvedValue(undefined),
    buildKey:          (...p: string[]) => `postgrify:${p.join(":")}`,
  })),
  TTL: { ROW_QUERY: 30, SCHEMA: 300, TABLE_LIST: 120, DB_SIZE: 60 },
}));

let server: FastifyInstance;
let editorToken: string;
let viewerToken: string;
let adminToken: string;

beforeAll(async () => {
  server = Fastify({ logger: false });

  const { PoolManager } = await import("../../src/services/poolManager.js");
  const { CacheService } = await import("../../src/services/cacheService.js");
  const { JwtService: Jwt } = await import("../../src/services/jwtService.js");
  const jwtSvc = new Jwt(JWT_SECRET);

  editorToken = await jwtSvc.signDbUserToken("project1", "user-001", "alice@test.com", "editor");
  viewerToken = await jwtSvc.signDbUserToken("project1", "user-002", "bob@test.com",   "viewer");
  adminToken  = await jwtSvc.signAdminToken();

  server.decorate("poolManager", new PoolManager({} as never));
  server.decorate("cache",       new CacheService());
  server.decorateRequest("user",   null);
  server.decorateRequest("dbName", null);
  server.decorateRequest("dbUser", null);

  // authenticate: admin ve DB-scoped token kabul eder
  server.decorate("authenticate", async (req: never, reply: never) => {
    const auth = (req as { headers: Record<string, string> }).headers.authorization;
    if (!auth?.startsWith("Bearer ")) return (reply as { status: (n: number) => { send: (b: unknown) => void } }).status(401).send({ error: "Unauthorized" });
    const payload = await jwtSvc.verifyAdminOrDb(auth.slice(7));
    if (!payload) return (reply as { status: (n: number) => { send: (b: unknown) => void } }).status(401).send({ error: "Invalid" });
    (req as { user: unknown }).user = payload;
  });

  server.decorate("authenticateAdmin", async () => {});

  // authenticateAny: admin, DB-scoped ve DB-user token'ları kabul eder
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
});

afterAll(async () => {
  await server.close();
  vi.unstubAllEnvs();
});

describe("SORUN #H — DB user token /query endpoint erişimi", () => {
  it("editor rolü SELECT query yapabilmeli (200)", async () => {
    const res = await server.inject({
      method:  "POST",
      url:     "/project1/query",
      headers: { Authorization: `Bearer ${editorToken}` },
      payload: { sql: "SELECT 1" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty("rows");
    expect(body).toHaveProperty("total");
    expect(body.limit).toBeNull();
    expect(body.offset).toBeNull();
  });

  it("viewer rolü /query → 403 (query scope yok)", async () => {
    const res = await server.inject({
      method:  "POST",
      url:     "/project1/query",
      headers: { Authorization: `Bearer ${viewerToken}` },
      payload: { sql: "SELECT 1" },
    });

    expect(res.statusCode).toBe(403);
  });

  it("admin token /query → 200", async () => {
    const res = await server.inject({
      method:  "POST",
      url:     "/project1/query",
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: { sql: "SELECT 1" },
    });

    expect(res.statusCode).toBe(200);
  });

  it("token olmadan /query → 401", async () => {
    const res = await server.inject({
      method:  "POST",
      url:     "/project1/query",
      payload: { sql: "SELECT 1" },
    });

    expect(res.statusCode).toBe(401);
  });

  it("editor rolü SELECT-only kısıtına tabidir (DROP → 403)", async () => {
    const res = await server.inject({
      method:  "POST",
      url:     "/project1/query",
      headers: { Authorization: `Bearer ${editorToken}` },
      payload: { sql: "DROP TABLE tweets" },
    });

    // SELECT-only mod — DDL reddedilir
    expect(res.statusCode).toBe(403);
  });
});