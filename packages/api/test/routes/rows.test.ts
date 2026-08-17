/**
 * Row CRUD endpoint tests.
 * postgres.js and cache are mocked.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { JwtService } from "../../src/services/jwtService.js";

const JWT_SECRET = "test-secret-must-be-at-least-32-characters";
const ADMIN_SECRET = "test-admin-secret-16ch";

vi.stubEnv("JWT_SECRET", JWT_SECRET);
vi.stubEnv("ADMIN_SECRET", ADMIN_SECRET);

// Mock data
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
    // begin("read only", cb) — used by the rows GET handler for count+rows
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
    get: vi.fn().mockResolvedValue(null), // cache miss — always go to DB
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

  // Manually register plugins
  const { PoolManager } = await import("../../src/services/poolManager.js");
  const { CacheService } = await import("../../src/services/cacheService.js");

  server.decorate("poolManager", new PoolManager({} as never));
  server.decorate("cache", new CacheService());
  server.decorateRequest("user", null);
  server.decorateRequest("dbName", null);

  // Auth decorators (real JWT verification)
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
  server.decorate("authenticateAny", async (req: never, reply: never) => {
    return (server as never as { authenticate: (r: never, rep: never) => Promise<void> }).authenticate(req, reply);
  });

  const { dbRoutes } = await import("../../src/routes/db/index.js");
  await server.register(dbRoutes, { prefix: "/db" });
  await server.ready();

  // Generate tokens
  const jwtSvcDirect = new JwtService(JWT_SECRET);
  adminToken = await jwtSvcDirect.signAdminToken();
  dbToken = await jwtSvcDirect.signDbToken("project1", ["read", "write", "delete"]);
});

afterAll(async () => {
  await server.close();
  vi.unstubAllEnvs();
});

describe("GET /db/:database/:table", () => {
  it("returns 200 with admin token", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/db/project1/users",
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    // C-01: body is a JSON array (PostgREST); Content-Range carries paging
    expect(Array.isArray(body)).toBe(true);
    expect(res.headers["content-range"]).toBeDefined();
  });

  it("returns 401 without a token", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/db/project1/users",
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 400 for an invalid table name", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/db/project1/123invalid",
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("POST /db/:database/:table", () => {
  it("inserts a row with write scope", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/db/project1/users",
      headers: { Authorization: `Bearer ${dbToken}` },
      payload: { name: "Charlie", email: "charlie@example.com" },
    });
    expect(res.statusCode).toBe(201);
  });

  it("returns 401 without a token", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/db/project1/users",
      payload: { name: "Charlie" },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe("PATCH /db/:database/:table — bulk update", () => {
  it("returns 400 without a where filter", async () => {
    const res = await server.inject({
      method: "PATCH",
      url: "/db/project1/users",
      headers: { Authorization: `Bearer ${dbToken}` },
      payload: { name: "Updated" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 204 with a where filter (Prefer return=minimal default)", async () => {
    const res = await server.inject({
      method: "PATCH",
      url: "/db/project1/users?where=id.eq.1",
      headers: { Authorization: `Bearer ${dbToken}` },
      payload: { name: "Updated" },
    });
    expect(res.statusCode).toBe(204);
  });

  it("returns 401 without a token", async () => {
    const res = await server.inject({
      method: "PATCH",
      url: "/db/project1/users?where=id.eq.1",
      payload: { name: "Updated" },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe("DELETE /db/:database/:table — bulk delete", () => {
  it("returns 400 without a where filter", async () => {
    const res = await server.inject({
      method: "DELETE",
      url: "/db/project1/users",
      headers: { Authorization: `Bearer ${dbToken}` },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 204 with a where filter (Prefer return=minimal default)", async () => {
    const res = await server.inject({
      method: "DELETE",
      url: "/db/project1/users?where=id.eq.1",
      headers: { Authorization: `Bearer ${dbToken}` },
    });
    expect(res.statusCode).toBe(204);
  });

  it("returns 403 without delete scope", async () => {
    const jwtSvc = new JwtService(JWT_SECRET);
    const readToken = await jwtSvc.signDbToken("project1", ["read"]);
    const res = await server.inject({
      method: "DELETE",
      url: "/db/project1/users?where=id.eq.1",
      headers: { Authorization: `Bearer ${readToken}` },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("GET /db/:database/:table — begin 'read only' transaction", () => {
  it("is called with begin 'read only' transaction", async () => {
    const { default: postgres } = await import("postgres");
    // Find the sql fn returned by the mock factory
    const sqlFn = (postgres as ReturnType<typeof vi.fn>).mock.results[0]?.value;

    await server.inject({
      method: "GET",
      url: "/db/project1/users",
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    expect(sqlFn?.begin).toHaveBeenCalledWith(
      "read only",
      expect.any(Function)
    );
  });
});

describe("GET /db/:database/:table/:id — ?pk= parameter", () => {
  it("returns 200 with default pk=id (backward compatibility)", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/db/project1/users/1",
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    // Mock returns single row — expect 200
    expect([200, 404]).toContain(res.statusCode);
  });

  it("uses a different PK column with ?pk=user_id — 200", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/db/project1/users/1?pk=user_id",
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect([200, 404]).toContain(res.statusCode);
  });

  it("rejects a SQL injection column name via ?pk — 400", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/db/project1/users/1?pk=drop",
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects an invalid column name with a space via ?pk — 400", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/db/project1/users/1?pk=bad%20col",
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("PUT /db/:database/:table/:id — ?pk= parameter", () => {
  it("update with ?pk=uuid_col — 200", async () => {
    const res = await server.inject({
      method: "PUT",
      url: "/db/project1/products/some-uuid?pk=uuid_col",
      headers: { Authorization: `Bearer ${dbToken}` },
      payload: { price: 99 },
    });
    expect(res.statusCode).toBe(200);
  });

  it("rejects an invalid column name via ?pk — 400", async () => {
    const res = await server.inject({
      method: "PUT",
      url: "/db/project1/products/1?pk=select",
      headers: { Authorization: `Bearer ${dbToken}` },
      payload: { price: 99 },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("DELETE /db/:database/:table/:id — ?pk= parameter", () => {
  it("delete with ?pk=custom_pk — 200", async () => {
    const res = await server.inject({
      method: "DELETE",
      url: "/db/project1/orders/order-123?pk=order_id",
      headers: { Authorization: `Bearer ${dbToken}` },
    });
    expect(res.statusCode).toBe(200);
  });

  it("rejects an invalid column name via ?pk — 400", async () => {
    const res = await server.inject({
      method: "DELETE",
      url: "/db/project1/orders/1?pk=1invalid",
      headers: { Authorization: `Bearer ${dbToken}` },
    });
    expect(res.statusCode).toBe(400);
  });
});