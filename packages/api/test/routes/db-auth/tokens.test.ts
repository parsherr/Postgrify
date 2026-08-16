/**
 * Auth tokens route testleri — login / logout / refresh.
 *
 * POST /:database/auth/login   → kimlik doğrula
 * POST /:database/auth/refresh → yeni access token
 * POST /:database/auth/logout  → session revoke
 */

import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from "vitest";
import Fastify, { type FastifyInstance, type FastifyRequest, type FastifyReply } from "fastify";
import { JwtService } from "../../../src/services/jwtService.js";

const JWT_SECRET = "test-secret-must-be-at-least-32-characters";

const mockVerifyPassword = vi.fn();
const mockGetAuthSetting = vi.fn();

vi.mock("../../../src/routes/db/auth/provision.js", () => ({
  ensureAuthSchema: vi.fn().mockResolvedValue(undefined),
  getApiKey: vi.fn().mockResolvedValue("test-api-key"),
  getAuthSetting: mockGetAuthSetting,
  insertAuditLog: vi.fn().mockResolvedValue(undefined),
  provisionApiKey: vi.fn().mockResolvedValue("test-api-key"),
}));

vi.mock("../../../src/services/passwordService.js", () => ({
  hashPassword: vi.fn().mockResolvedValue("$hashed$"),
  verifyPassword: mockVerifyPassword,
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
// sql mock'unu her test başında yeniden configure etmek için
let sqlFnRef: ReturnType<typeof vi.fn>;

beforeAll(async () => {
  server = Fastify({ logger: false });

  const { PoolManager } = await import("../../../src/services/poolManager.js");
  const { CacheService } = await import("../../../src/services/cacheService.js");
  const jwtSvc = new JwtService(JWT_SECRET);

  // sql mock'una referans al
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

  const { authTokensRoute } = await import("../../../src/routes/db/auth/tokens.js");
  await server.register(authTokensRoute);
  await server.ready();
});

afterAll(async () => {
  await server.close();
});

beforeEach(() => {
  vi.clearAllMocks();
  // Default: her zaman en az bir call için boş dizi döner
  sqlFnRef.mockResolvedValue([]);
  mockVerifyPassword.mockResolvedValue(true);
  mockGetAuthSetting.mockResolvedValue("false"); // email_verify_required = false
});

// ─── Login ────────────────────────────────────────────────────────────────────

describe("POST /:database/auth/login", () => {
  it("Başarılı login → 200, tokens ve user döner", async () => {
    // Login SQL sırası: SELECT user, [verifyPassword], UPDATE last_login, INSERT session
    sqlFnRef
      // SELECT users WHERE email
      .mockResolvedValueOnce([{
        id: "user-uuid-1",
        email: "test@example.com",
        password_hash: "$hashed$",
        role: "viewer",
        is_active: true,
        email_verified: true,
      }])
      // UPDATE last_login
      .mockResolvedValueOnce([])
      // INSERT sessions
      .mockResolvedValueOnce([]);
    mockVerifyPassword.mockResolvedValue(true);
    mockGetAuthSetting.mockResolvedValue("false");

    const res = await server.inject({
      method: "POST",
      url: "/testdb/auth/login",
      payload: { email: "test@example.com", password: "password123" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty("access_token");
    expect(body).toHaveProperty("refresh_token");
    expect(typeof body.expires_in).toBe("number");
    expect(typeof body.expires_at).toBe("number");
    expect(body.token_type).toBe("bearer");
    expect(body.user).toMatchObject({
      email: "test@example.com",
      role: "authenticated",
      aud: "authenticated",
      app_metadata: { role: "viewer", is_active: true, provider: "email" },
    });
  });

  it("Var olmayan email → 401 Invalid credentials", async () => {
    sqlFnRef.mockResolvedValue([]); // kullanıcı bulunamadı
    mockVerifyPassword.mockResolvedValue(false);

    const res = await server.inject({
      method: "POST",
      url: "/testdb/auth/login",
      payload: { email: "noone@example.com", password: "password123" },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().error).toContain("Invalid credentials");
  });

  it("Yanlış şifre → 401 Invalid credentials", async () => {
    sqlFnRef.mockResolvedValueOnce([{
      id: "user-uuid-1",
      email: "test@example.com",
      password_hash: "$hashed$",
      role: "viewer",
      is_active: true,
      email_verified: true,
    }]);
    mockVerifyPassword.mockResolvedValue(false); // şifre yanlış

    const res = await server.inject({
      method: "POST",
      url: "/testdb/auth/login",
      payload: { email: "test@example.com", password: "wrongpass" },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().error).toContain("Invalid credentials");
  });

  it("Disabled kullanıcı → 403 Account is disabled", async () => {
    sqlFnRef.mockResolvedValueOnce([{
      id: "user-uuid-1",
      email: "test@example.com",
      password_hash: "$hashed$",
      role: "viewer",
      is_active: false, // disabled
      email_verified: true,
    }]);

    const res = await server.inject({
      method: "POST",
      url: "/testdb/auth/login",
      payload: { email: "test@example.com", password: "password123" },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error).toContain("disabled");
  });

  it("email_verify_required=true ve email doğrulanmamışsa → 403", async () => {
    sqlFnRef.mockResolvedValueOnce([{
      id: "user-uuid-1",
      email: "test@example.com",
      password_hash: "$hashed$",
      role: "viewer",
      is_active: true,
      email_verified: false, // doğrulanmamış
    }]);
    mockGetAuthSetting.mockResolvedValue("true"); // email_verify_required = true

    const res = await server.inject({
      method: "POST",
      url: "/testdb/auth/login",
      payload: { email: "test@example.com", password: "password123" },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error).toContain("Email not verified");
  });

  it("Eksik email alanı → 400 validation error", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/testdb/auth/login",
      payload: { password: "password123" }, // email yok
    });

    expect(res.statusCode).toBe(400);
  });
});

// ─── Refresh ──────────────────────────────────────────────────────────────────

describe("POST /:database/auth/refresh", () => {
  it("Geçerli refresh token → 200, yeni tokens döner", async () => {
    sqlFnRef
      // 1) ensureAuthSchema unsafe call — skip via default []
      // 2) SELECT sessions JOIN users
      .mockResolvedValueOnce([{
        id: "session-uuid-1",
        user_id: "user-uuid-1",
        expires_at: new Date(Date.now() + 86400000).toISOString(),
        email: "test@example.com",
        role: "viewer",
        is_active: true,
      }])
      // 3) UPDATE sessions SET revoked = true
      .mockResolvedValueOnce([])
      // 4) INSERT new session
      .mockResolvedValueOnce([]);

    const res = await server.inject({
      method: "POST",
      url: "/testdb/auth/refresh",
      payload: { refreshToken: "valid-refresh-token-abc" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty("accessToken");
    expect(body).toHaveProperty("refreshToken");
    expect(body).toHaveProperty("expiresIn");
  });

  it("Geçersiz/revoked refresh token → 401", async () => {
    sqlFnRef.mockResolvedValue([]); // session bulunamadı

    const res = await server.inject({
      method: "POST",
      url: "/testdb/auth/refresh",
      payload: { refreshToken: "revoked-or-invalid-token" },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().error).toContain("Invalid or expired");
  });

  it("Disabled kullanıcının refresh token'ı → 403", async () => {
    sqlFnRef.mockResolvedValueOnce([{
      id: "session-uuid-1",
      user_id: "user-uuid-1",
      expires_at: new Date(Date.now() + 86400000).toISOString(),
      email: "test@example.com",
      role: "viewer",
      is_active: false, // disabled
    }]);

    const res = await server.inject({
      method: "POST",
      url: "/testdb/auth/refresh",
      payload: { refreshToken: "valid-token-for-disabled-user" },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error).toContain("disabled");
  });

  it("Eksik refreshToken alanı → 400", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/testdb/auth/refresh",
      payload: {}, // refreshToken yok
    });

    expect(res.statusCode).toBe(400);
  });
});

// ─── Logout ───────────────────────────────────────────────────────────────────

describe("POST /:database/auth/logout", () => {
  it("Başarılı logout → 204", async () => {
    sqlFnRef.mockResolvedValue([{ user_id: "user-uuid-1" }]);

    const res = await server.inject({
      method: "POST",
      url: "/testdb/auth/logout",
      payload: { refreshToken: "valid-refresh-token" },
    });

    expect(res.statusCode).toBe(204);
    expect(res.body).toBe("");
  });

  it("Var olmayan token ile logout → 204 (idempotent)", async () => {
    sqlFnRef.mockResolvedValue([]); // session bulunamadı — sorun değil

    const res = await server.inject({
      method: "POST",
      url: "/testdb/auth/logout",
      payload: { refreshToken: "nonexistent-token" },
    });

    expect(res.statusCode).toBe(204);
  });
});