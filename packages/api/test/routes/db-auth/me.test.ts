/**
 * GET /:database/auth/me testleri.
 *
 * DB user JWT gerektirir — admin token reddedilir.
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

beforeAll(async () => {
  jwtSvc = new JwtService(JWT_SECRET);

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
  });
  server.decorate("authenticateAdmin", async () => {});
  // me.ts, jwtService decorator'ını kullanır
  server.decorate("jwtService", jwtSvc);

  const { authMeRoute } = await import("../../../src/routes/db/auth/me.js");
  await server.register(authMeRoute);
  await server.ready();
});

afterAll(async () => {
  await server.close();
});

beforeEach(() => {
  vi.clearAllMocks();
  sqlFnRef.mockResolvedValue([]);
});

describe("GET /:database/auth/me", () => {
  it("Geçerli DB user token → 200, user objesi döner", async () => {
    const dbUserToken = await jwtSvc.signDbUserToken(
      "testdb",
      "user-uuid-1",
      "user@example.com",
      "viewer",
      "1h"
    );

    sqlFnRef.mockResolvedValue([{
      id: "user-uuid-1",
      email: "user@example.com",
      role: "viewer",
      full_name: "Test User",
      avatar_url: null,
      email_verified: true,
      is_active: true,
      provider: "email",
      created_at: "2024-01-01T00:00:00Z",
      last_login: null,
      metadata: {},
    }]);

    const res = await server.inject({
      method: "GET",
      url: "/testdb/auth/me",
      headers: { authorization: `Bearer ${dbUserToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.email).toBe("user@example.com");
    expect(body.role).toBe("viewer");
    // password_hash response'da olmamalı
    expect(body).not.toHaveProperty("password_hash");
  });

  it("Authorization header yok → 401 Missing authorization", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/testdb/auth/me",
      // Header yok
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().error).toContain("Missing authorization");
  });

  it("Admin token (iss: postgrify) → 401 Invalid or expired token", async () => {
    const adminToken = await jwtSvc.signAdminToken();

    const res = await server.inject({
      method: "GET",
      url: "/testdb/auth/me",
      headers: { authorization: `Bearer ${adminToken}` },
    });

    // verifyDbUser admin token'ı reddeder
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toContain("Invalid or expired token");
  });

  it("Başka DB için üretilmiş token → 403 Token database mismatch", async () => {
    const otherDbToken = await jwtSvc.signDbUserToken(
      "otherdb", // farklı DB
      "user-uuid-1",
      "user@example.com",
      "viewer",
      "1h"
    );

    const res = await server.inject({
      method: "GET",
      url: "/testdb/auth/me", // testdb için isteniyor ama token otherdb için
      headers: { authorization: `Bearer ${otherDbToken}` },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error).toContain("mismatch");
  });

  it("Kullanıcı DB'de bulunamadıysa → 404", async () => {
    const dbUserToken = await jwtSvc.signDbUserToken(
      "testdb",
      "deleted-user-uuid",
      "gone@example.com",
      "viewer",
      "1h"
    );

    sqlFnRef.mockResolvedValue([]); // kullanıcı yok

    const res = await server.inject({
      method: "GET",
      url: "/testdb/auth/me",
      headers: { authorization: `Bearer ${dbUserToken}` },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error).toContain("not found");
  });
});