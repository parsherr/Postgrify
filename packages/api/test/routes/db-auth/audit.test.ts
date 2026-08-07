/**
 * Audit log route testleri.
 *
 * GET /:database/auth/audit — paginated audit log
 * schema scope gerektirir.
 */

import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from "vitest";
import Fastify, { type FastifyInstance, type FastifyRequest, type FastifyReply } from "fastify";
import { JwtService } from "../../../src/services/jwtService.js";

const JWT_SECRET = "test-secret-must-be-at-least-32-characters";

vi.mock("../../../src/routes/db/auth/provision.js", () => ({
  ensureAuthSchema: vi.fn().mockResolvedValue(undefined),
  getApiKey: vi.fn().mockResolvedValue("test-api-key"),
  getAuthSetting: vi.fn().mockResolvedValue("true"),
  insertAuditLog: vi.fn().mockResolvedValue(undefined),
  provisionApiKey: vi.fn().mockResolvedValue("test-api-key"),
}));

vi.mock("postgres", () => {
  const sqlFn = vi.fn().mockResolvedValue([]);
  sqlFn.unsafe = vi.fn().mockResolvedValue([]);
  sqlFn.end = vi.fn().mockResolvedValue(undefined);
  return { default: vi.fn(() => sqlFn) };
});

vi.mock("../../../src/services/cacheService.js", () => ({
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
let jwtSvc: JwtService;
let sqlFnRef: ReturnType<typeof vi.fn>;
let adminToken: string;
let schemaToken: string;
let noSchemaToken: string;

beforeAll(async () => {
  jwtSvc = new JwtService(JWT_SECRET);
  adminToken = await jwtSvc.signAdminToken();
  schemaToken = await jwtSvc.signDbToken("testdb", ["schema"]);
  noSchemaToken = await jwtSvc.signDbToken("testdb", ["read"]);

  server = Fastify({ logger: false });

  const { PoolManager } = await import("../../../src/services/poolManager.js");
  const { CacheService } = await import("../../../src/services/cacheService.js");

  const { default: postgres } = await import("postgres");
  sqlFnRef = (postgres as unknown as ReturnType<typeof vi.fn>)();

  server.decorate("poolManager", new PoolManager({} as never));
  server.decorate("cache", new CacheService());
  server.decorateRequest("user", null);
  server.decorateRequest("dbName", null);

  server.decorate("authenticate", async (req: FastifyRequest, reply: FastifyReply) => {
    const auth = req.headers.authorization;
    if (!auth?.startsWith("Bearer ")) return reply.status(401).send({ error: "Unauthorized" });
    const payload = await jwtSvc.verifyAdminOrDb(auth.slice(7));
    if (!payload) return reply.status(401).send({ error: "Invalid token" });
    req.user = payload;
    if (!req.dbName) req.dbName = (req.params as Record<string, string>)?.database;
  });
  server.decorate("authenticateAdmin", async () => {});
  server.decorate("jwtService", jwtSvc);

  const { authAuditRoute } = await import("../../../src/routes/db/auth/audit.js");
  await server.register(authAuditRoute);
  await server.ready();
});

afterAll(async () => {
  await server.close();
});

beforeEach(() => {
  vi.clearAllMocks();
  sqlFnRef.mockResolvedValue([]);
});

const MOCK_AUDIT_ROWS = [
  {
    id: "audit-1",
    user_id: "user-uuid-1",
    user_email: "a@ex.com",
    event: "login",
    ip: "127.0.0.1",
    user_agent: "test-agent",
    metadata: {},
    created_at: "2024-01-01T10:00:00Z",
  },
  {
    id: "audit-2",
    user_id: "user-uuid-2",
    user_email: "b@ex.com",
    event: "signup",
    ip: "127.0.0.1",
    user_agent: "test-agent",
    metadata: {},
    created_at: "2024-01-01T09:00:00Z",
  },
];

describe("GET /:database/auth/audit", () => {
  it("Admin token → 200, audit log döner", async () => {
    sqlFnRef
      .mockResolvedValueOnce(MOCK_AUDIT_ROWS)
      .mockResolvedValueOnce([{ count: 2 }]);

    const res = await server.inject({
      method: "GET",
      url: "/testdb/auth/audit",
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toHaveLength(2);
    expect(body.total).toBe(2);
    expect(body.limit).toBe(50);
    expect(body.offset).toBe(0);
  });

  it("schema scope DB token → 200", async () => {
    sqlFnRef
      .mockResolvedValueOnce(MOCK_AUDIT_ROWS)
      .mockResolvedValueOnce([{ count: 2 }]);

    const res = await server.inject({
      method: "GET",
      url: "/testdb/auth/audit",
      headers: { authorization: `Bearer ${schemaToken}` },
    });

    expect(res.statusCode).toBe(200);
  });

  it("Pagination parametreleri → 200, limit ve offset dönüyor", async () => {
    sqlFnRef
      .mockResolvedValueOnce([MOCK_AUDIT_ROWS[0]])
      .mockResolvedValueOnce([{ count: 10 }]);

    const res = await server.inject({
      method: "GET",
      url: "/testdb/auth/audit?limit=1&offset=5",
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.limit).toBe(1);
    expect(body.offset).toBe(5);
  });

  it("event filtresi ile → 200", async () => {
    sqlFnRef
      .mockResolvedValueOnce([MOCK_AUDIT_ROWS[0]])
      .mockResolvedValueOnce([{ count: 1 }]);

    const res = await server.inject({
      method: "GET",
      url: "/testdb/auth/audit?event=login",
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data).toHaveLength(1);
  });

  it("schema scope yok → 403 Insufficient scope", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/testdb/auth/audit",
      headers: { authorization: `Bearer ${noSchemaToken}` },
    });

    expect(res.statusCode).toBe(403);
  });

  it("Token yok → 401", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/testdb/auth/audit",
    });

    expect(res.statusCode).toBe(401);
  });
});