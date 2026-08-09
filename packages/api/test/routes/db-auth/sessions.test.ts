/**
 * Per-DB session yönetim route testleri.
 *
 * GET    /:database/auth/sessions       — aktif session listesi
 * DELETE /:database/auth/sessions/:id  — belirli session revoke
 * DELETE /:database/auth/sessions?user_id= — kullanıcının tüm session'ları
 *
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

  const { authSessionsRoute } = await import("../../../src/routes/db/auth/sessions.js");
  await server.register(authSessionsRoute);
  await server.ready();
});

afterAll(async () => {
  await server.close();
});

beforeEach(() => {
  vi.clearAllMocks();
  sqlFnRef.mockResolvedValue([]);
});

const MOCK_SESSIONS = [
  {
    id: "sess-1",
    user_id: "user-uuid-1",
    user_email: "a@ex.com",
    expires_at: new Date(Date.now() + 86400000).toISOString(),
    created_at: "2024-01-01T00:00:00Z",
    revoked: false,
    ip: "127.0.0.1",
    user_agent: "test",
  },
];

describe("GET /:database/auth/sessions", () => {
  it("Admin token → 200, session listesi döner", async () => {
    sqlFnRef
      .mockResolvedValueOnce(MOCK_SESSIONS)
      .mockResolvedValueOnce([{ count: 1 }]);

    const res = await server.inject({
      method: "GET",
      url: "/testdb/auth/sessions",
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toHaveLength(1);
    expect(body.total).toBe(1);
  });

  it("schema scope DB token → 200", async () => {
    sqlFnRef
      .mockResolvedValueOnce(MOCK_SESSIONS)
      .mockResolvedValueOnce([{ count: 1 }]);

    const res = await server.inject({
      method: "GET",
      url: "/testdb/auth/sessions",
      headers: { authorization: `Bearer ${schemaToken}` },
    });

    expect(res.statusCode).toBe(200);
  });

  it("schema scope yok → 403 Insufficient scope", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/testdb/auth/sessions",
      headers: { authorization: `Bearer ${noSchemaToken}` },
    });

    expect(res.statusCode).toBe(403);
  });

  it("Token yok → 401", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/testdb/auth/sessions",
    });

    expect(res.statusCode).toBe(401);
  });
});

// UUID v4 formatında test değerleri — UUID validation artık zorunlu
const TEST_SESSION_UUID = "550e8400-e29b-41d4-a716-446655440000";
const TEST_USER_UUID    = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";

describe("DELETE /:database/auth/sessions/:id", () => {
  it("Admin token ile belirli session revoke → 204", async () => {
    sqlFnRef.mockResolvedValue([]);

    const res = await server.inject({
      method: "DELETE",
      url: `/testdb/auth/sessions/${TEST_SESSION_UUID}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(204);
    expect(res.body).toBe("");
  });

  it("geçersiz UUID formatı → 400", async () => {
    const res = await server.inject({
      method: "DELETE",
      url: "/testdb/auth/sessions/not-a-uuid",
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(400);
  });

  it("schema scope yok → 403", async () => {
    const res = await server.inject({
      method: "DELETE",
      url: `/testdb/auth/sessions/${TEST_SESSION_UUID}`,
      headers: { authorization: `Bearer ${noSchemaToken}` },
    });

    expect(res.statusCode).toBe(403);
  });
});

describe("DELETE /:database/auth/sessions?user_id=", () => {
  it("user_id ile tüm session'ları revoke → 204", async () => {
    sqlFnRef.mockResolvedValue([]);

    const res = await server.inject({
      method: "DELETE",
      url: `/testdb/auth/sessions?user_id=${TEST_USER_UUID}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(204);
  });

  it("geçersiz user_id UUID formatı → 400", async () => {
    const res = await server.inject({
      method: "DELETE",
      url: "/testdb/auth/sessions?user_id=user-uuid-1",
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(400);
  });
});