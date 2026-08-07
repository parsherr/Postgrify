/**
 * Auth users CRUD route testleri.
 *
 * GET/POST/PATCH/DELETE /:database/auth/users
 * Admin veya uygun scope gerektirir.
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

vi.mock("../../../src/services/passwordService.js", () => ({
  hashPassword: vi.fn().mockResolvedValue("$hashed$"),
  verifyPassword: vi.fn().mockResolvedValue(true),
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

vi.mock("../../../src/services/emailService.js", () => ({
  sendEmail: vi.fn().mockResolvedValue(undefined),
  buildVerifyEmail: vi.fn().mockReturnValue({ to: "x", subject: "x", html: "x" }),
  buildPasswordResetEmail: vi.fn().mockReturnValue({ to: "x", subject: "x", html: "x" }),
  buildMagicLinkEmail: vi.fn().mockReturnValue({ to: "x", subject: "x", html: "x" }),
}));

let server: FastifyInstance;
let jwtSvc: JwtService;
let sqlFnRef: ReturnType<typeof vi.fn>;
let adminToken: string;

// read scope'lu DB token (testdb için)
let readDbToken: string;
// schema scope yok
let noSchemaToken: string;

beforeAll(async () => {
  jwtSvc = new JwtService(JWT_SECRET);
  adminToken = await jwtSvc.signAdminToken();
  readDbToken = await jwtSvc.signDbToken("testdb", ["read", "write", "delete"]);
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

  // authenticate: admin token ise role=admin set et; DB token ise role=db + scope set et
  server.decorate("authenticate", async (req: FastifyRequest, reply: FastifyReply) => {
    const auth = req.headers.authorization;
    if (!auth?.startsWith("Bearer ")) return reply.status(401).send({ error: "Unauthorized" });
    const payload = await jwtSvc.verifyAdminOrDb(auth.slice(7));
    if (!payload) return reply.status(401).send({ error: "Invalid token" });
    req.user = payload;
    // dbName set et (dbResolverHook burada yok, manuel)
    if (!req.dbName) req.dbName = (req.params as Record<string, string>)?.database;
  });
  server.decorate("authenticateAdmin", async () => {});
  server.decorate("jwtService", jwtSvc);

  const { authUsersRoute } = await import("../../../src/routes/db/auth/users.js");
  await server.register(authUsersRoute);
  await server.ready();
});

afterAll(async () => {
  await server.close();
});

beforeEach(() => {
  vi.clearAllMocks();
  sqlFnRef.mockResolvedValue([]);
});

const MOCK_USERS = [
  { id: "uuid-1", email: "a@ex.com", role: "viewer", is_active: true, created_at: "2024-01-01", last_login: null, metadata: {} },
  { id: "uuid-2", email: "b@ex.com", role: "editor", is_active: true, created_at: "2024-01-02", last_login: null, metadata: {} },
];

describe("GET /:database/auth/users", () => {
  it("Admin token → 200, users listesi döner", async () => {
    sqlFnRef.mockResolvedValue(MOCK_USERS);

    const res = await server.inject({
      method: "GET",
      url: "/testdb/auth/users",
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.users).toHaveLength(2);
    expect(body.total).toBe(2);
  });

  it("read scope DB token → 200", async () => {
    sqlFnRef.mockResolvedValue(MOCK_USERS);

    const res = await server.inject({
      method: "GET",
      url: "/testdb/auth/users",
      headers: { authorization: `Bearer ${readDbToken}` },
    });

    expect(res.statusCode).toBe(200);
  });

  it("Token yok → 401", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/testdb/auth/users",
    });

    expect(res.statusCode).toBe(401);
  });
});

describe("POST /:database/auth/users", () => {
  it("Admin token ile yeni kullanıcı → 201", async () => {
    sqlFnRef.mockResolvedValue([{
      id: "new-uuid",
      email: "new@ex.com",
      role: "viewer",
      is_active: true,
      created_at: "2024-01-01",
      last_login: null,
      metadata: {},
    }]);

    const res = await server.inject({
      method: "POST",
      url: "/testdb/auth/users",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { email: "new@ex.com", password: "password123", role: "viewer" },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().email).toBe("new@ex.com");
  });

  it("write scope eksik (only read scope) → 403", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/testdb/auth/users",
      headers: { authorization: `Bearer ${noSchemaToken}` },
      payload: { email: "test@ex.com", password: "password123" },
    });

    expect(res.statusCode).toBe(403);
  });
});

describe("PATCH /:database/auth/users/:id", () => {
  it("Admin token ile güncelleme → 200", async () => {
    sqlFnRef.mockImplementation((strings: TemplateStringsArray) => {
      const q = strings[0] ?? "";
      if (q.includes("RETURNING")) {
        return Promise.resolve([{
          id: "uuid-1",
          email: "a@ex.com",
          role: "editor",
          is_active: true,
          created_at: "2024-01-01",
          last_login: null,
          metadata: {},
        }]);
      }
      return Promise.resolve([]);
    });
    // unsafe kullanır — ayrıca mock et
    sqlFnRef.unsafe = vi.fn().mockResolvedValue([{
      id: "uuid-1", email: "a@ex.com", role: "editor", is_active: true,
      created_at: "2024-01-01", last_login: null, metadata: {},
    }]);

    const res = await server.inject({
      method: "PATCH",
      url: "/testdb/auth/users/uuid-1",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { role: "editor" },
    });

    expect(res.statusCode).toBe(200);
  });

  it("Body boş → 400 No fields to update", async () => {
    const res = await server.inject({
      method: "PATCH",
      url: "/testdb/auth/users/uuid-1",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("No fields");
  });
});

describe("DELETE /:database/auth/users/:id", () => {
  it("Admin token ile silme → 204", async () => {
    // DELETE ... RETURNING id → silinenin id'sini döndürür
    sqlFnRef.mockResolvedValueOnce([{ id: "uuid-1" }]);

    const res = await server.inject({
      method: "DELETE",
      url: "/testdb/auth/users/uuid-1",
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(204);
  });

  it("Token yok → 401", async () => {
    const res = await server.inject({
      method: "DELETE",
      url: "/testdb/auth/users/uuid-1",
    });

    expect(res.statusCode).toBe(401);
  });
});