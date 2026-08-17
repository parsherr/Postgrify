/**
 * Issue #5 Fix — POST /:database/query response shape
 *
 * query.ts response: { rows, total, limit, offset }
 * - rows: array of returned row objects
 * - total: number of rows returned (= rows.length for raw SQL)
 * - limit: always null (pagination is indeterminate for raw SQL)
 * - offset: always null (pagination is indeterminate for raw SQL)
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

const MOCK_ROWS = [{ id: 1, name: "Alice" }, { id: 2, name: "Bob" }];

vi.mock("postgres", () => {
  const sqlFn: Record<string, unknown> = Object.assign(
    vi.fn().mockResolvedValue(MOCK_ROWS),
    {
      unsafe: vi.fn().mockResolvedValue(MOCK_ROWS),
      end: vi.fn().mockResolvedValue(undefined),
      begin: vi.fn().mockImplementation(
        (_mode: string, cb: (sql: unknown) => unknown) => cb(sqlFn)
      ),
    }
  );
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
    buildKey: (...p: string[]) => `postgrify:${p.join(":")}`,
    redisClient: null,
  })),
  TTL: { ROW_QUERY: 30, SCHEMA: 300, TABLE_LIST: 120, DB_SIZE: 60 },
}));

vi.mock("../../src/routes/db/auth/provision.js", () => ({
  insertAuditLog: vi.fn().mockResolvedValue(undefined),
  ensureAuthSchema: vi.fn().mockResolvedValue(undefined),
  getAuthSetting: vi.fn().mockResolvedValue("false"),
}));

let server: FastifyInstance;
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
  server.decorateRequest("dbUser", null);

  // authenticateAny MUST come before dbRoutes — dbRoutes calls addHook at load time
  server.decorate("authenticateAny", async (req: never, reply: never) => {
    const auth = (req as { headers: Record<string, string> }).headers.authorization;
    if (!auth?.startsWith("Bearer "))
      return (reply as { status: (n: number) => { send: (b: unknown) => void } })
        .status(401).send({ error: "Unauthorized" });
    const token = auth.slice(7);
    const adminOrDb = await jwtSvc.verifyAdminOrDb(token);
    if (adminOrDb) { (req as { user: unknown }).user = adminOrDb; return; }
    const dbUser = await jwtSvc.verifyDbUser(token);
    if (dbUser) { (req as { dbUser: unknown }).dbUser = dbUser; return; }
    return (reply as { status: (n: number) => { send: (b: unknown) => void } })
      .status(401).send({ error: "Invalid token" });
  });

  server.decorate("authenticate", async (req: never, reply: never) => {
    const auth = (req as { headers: Record<string, string> }).headers.authorization;
    if (!auth?.startsWith("Bearer "))
      return (reply as { status: (n: number) => { send: (b: unknown) => void } })
        .status(401).send({ error: "Unauthorized" });
    const payload = await jwtSvc.verifyAdminOrDb(auth.slice(7));
    if (!payload)
      return (reply as { status: (n: number) => { send: (b: unknown) => void } })
        .status(401).send({ error: "Invalid" });
    (req as { user: unknown }).user = payload;
  });

  server.decorate("authenticateAdmin", async () => {});

  server.addHook("preHandler", async (req) => {
    (req as { dbName: string }).dbName = "project1";
  });

  const { dbRoutes } = await import("../../src/routes/db/index.js");
  await server.register(dbRoutes);
  await server.ready();

  const jwtSvcDirect = new JwtService(JWT_SECRET);
  queryToken = await jwtSvcDirect.signDbToken("project1", ["read", "query"]);
  readOnlyToken = await jwtSvcDirect.signDbToken("project1", ["read"]);
});

afterAll(async () => {
  await server.close();
  vi.unstubAllEnvs();
});

describe("Issue #5 — POST /:database/query response shape", () => {
  it("response should return { rows, total, limit: null, offset: null }", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/project1/query",
      headers: { Authorization: `Bearer ${queryToken}` },
      payload: { sql: "SELECT id, name FROM users LIMIT 2" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body).toHaveProperty("rows");
    expect(body).toHaveProperty("total");
    expect(body).toHaveProperty("limit");
    expect(body).toHaveProperty("offset");

    // limit/offset are indeterminate for raw SQL — must be explicitly null
    expect(body.limit).toBeNull();
    expect(body.offset).toBeNull();

    // total = rows.length (no COUNT for raw SQL)
    expect(Array.isArray(body.rows)).toBe(true);
    expect(typeof body.total).toBe("number");
    expect(body.total).toBe(body.rows.length);
  });

  it("should return 401 when no token is provided", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/project1/query",
      payload: { sql: "SELECT 1" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("should return 403 with a token that lacks the query scope", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/project1/query",
      headers: { Authorization: `Bearer ${readOnlyToken}` },
      payload: { sql: "SELECT 1" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("should return 400 when the sql field is missing", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/project1/query",
      headers: { Authorization: `Bearer ${queryToken}` },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });
});
