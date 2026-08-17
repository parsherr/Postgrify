/**
 * Auth users CRUD route tests.
 *
 * GET/POST/PATCH/DELETE /:database/auth/users
 * Requires admin or appropriate scope.
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

// DB token with read scope (for testdb)
let readDbToken: string;
// no schema scope
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

  // authenticate: set role=admin for admin token; set role=db + scope for DB token
  server.decorate("authenticate", async (req: FastifyRequest, reply: FastifyReply) => {
    const auth = req.headers.authorization;
    if (!auth?.startsWith("Bearer ")) return reply.status(401).send({ error: "Unauthorized" });
    const payload = await jwtSvc.verifyAdminOrDb(auth.slice(7));
    if (!payload) return reply.status(401).send({ error: "Invalid token" });
    req.user = payload;
    // set dbName (dbResolverHook is not here, done manually)
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
  function mockListQueries(users = MOCK_USERS, total = users.length) {
    sqlFnRef.mockImplementation(async (strings: TemplateStringsArray) => {
      const q = strings.join(" ");
      if (q.includes("count(*)")) return [{ total }];
      return users;
    });
  }

  it("Admin token → 200, returns users list", async () => {
    mockListQueries();

    const res = await server.inject({
      method: "GET",
      url: "/testdb/auth/users",
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.users).toHaveLength(2);
    expect(body.total).toBe(2);
    expect(body.page).toBe(1);
    expect(body.per_page).toBe(50);
    expect(body.aud).toBe("authenticated");
    expect(body.last_page).toBe(1);
    expect(body.next_page).toBeNull();
  });

  it("page/per_page pagination (C-17)", async () => {
    mockListQueries([MOCK_USERS[0]], 3);

    const res = await server.inject({
      method: "GET",
      url: "/testdb/auth/users?page=1&per_page=1",
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.users).toHaveLength(1);
    expect(body.total).toBe(3);
    expect(body.page).toBe(1);
    expect(body.per_page).toBe(1);
    expect(body.next_page).toBe(2);
    expect(body.last_page).toBe(3);
  });

  it("read scope DB token → 200", async () => {
    mockListQueries();

    const res = await server.inject({
      method: "GET",
      url: "/testdb/auth/users",
      headers: { authorization: `Bearer ${readDbToken}` },
    });

    expect(res.statusCode).toBe(200);
  });

  it("No token → 401", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/testdb/auth/users",
    });

    expect(res.statusCode).toBe(401);
  });
});

describe("POST /:database/auth/users", () => {
  it("New user with admin token → 201", async () => {
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
  it("Update with admin token → 200", async () => {
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
    // uses unsafe — mock separately
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

  it("Empty body → 400 No fields to update", async () => {
    const res = await server.inject({
      method: "PATCH",
      url: "/testdb/auth/users/uuid-1",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("No fields");
  });

  it("email_confirm + ban_duration (C-18)", async () => {
    sqlFnRef.unsafe = vi.fn().mockResolvedValue([{
      id: "uuid-1",
      email: "a@ex.com",
      role: "viewer",
      is_active: true,
      email_verified: true,
      locked_until: "2099-01-01T00:00:00.000Z",
      created_at: "2024-01-01",
      last_login: null,
      metadata: {},
    }]);

    const res = await server.inject({
      method: "PATCH",
      url: "/testdb/auth/users/uuid-1",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { email_confirm: true, ban_duration: "24h" },
    });

    expect(res.statusCode).toBe(200);
    const sql = (sqlFnRef.unsafe as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(sql).toContain("email_verified = TRUE");
    expect(sql).toContain("locked_until");
  });
});

describe("DELETE /:database/auth/users/:id", () => {
  it("Deletion with admin token → 204", async () => {
    // DELETE ... RETURNING id → returns the id of the deleted row
    sqlFnRef.mockResolvedValueOnce([{ id: "uuid-1" }]);

    const res = await server.inject({
      method: "DELETE",
      url: "/testdb/auth/users/uuid-1",
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(204);
  });

  it("No token → 401", async () => {
    const res = await server.inject({
      method: "DELETE",
      url: "/testdb/auth/users/uuid-1",
    });

    expect(res.statusCode).toBe(401);
  });
});