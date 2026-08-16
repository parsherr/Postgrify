/**
 * Signup route testleri — C-10 GoTrue session shape.
 *
 * POST /:database/auth/signup
 */

import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from "vitest";
import Fastify, { type FastifyInstance, type FastifyRequest, type FastifyReply } from "fastify";
import { JwtService } from "../../../src/services/jwtService.js";

const JWT_SECRET = "test-secret-must-be-at-least-32-characters";
vi.stubEnv("JWT_SECRET", JWT_SECRET);

const mockGetAuthSetting = vi.fn();
const mockSendEmail = vi.fn();

vi.mock("../../../src/routes/db/auth/provision.js", () => ({
  ensureAuthSchema: vi.fn().mockResolvedValue(undefined),
  getApiKey: vi.fn().mockResolvedValue("test-api-key"),
  getAuthSetting: mockGetAuthSetting,
  insertAuditLog: vi.fn().mockResolvedValue(undefined),
  provisionApiKey: vi.fn().mockResolvedValue("test-api-key"),
}));

vi.mock("../../../src/services/passwordService.js", () => ({
  hashPassword: vi.fn().mockResolvedValue("$hashed$"),
  verifyPassword: vi.fn().mockResolvedValue(true),
}));

vi.mock("../../../src/services/emailService.js", () => ({
  sendEmail: mockSendEmail,
  buildVerifyEmail: vi.fn().mockReturnValue({ to: "x", subject: "verify", html: "<a>verify</a>" }),
  buildPasswordResetEmail: vi.fn().mockReturnValue({ to: "x", subject: "x", html: "x" }),
  buildMagicLinkEmail: vi.fn().mockReturnValue({ to: "x", subject: "x", html: "x" }),
}));

vi.mock("postgres", () => {
  const sqlFn = vi.fn().mockResolvedValue([]);
  sqlFn.unsafe = vi.fn().mockResolvedValue([]);
  sqlFn.end = vi.fn().mockResolvedValue(undefined);
  return { default: vi.fn(() => sqlFn) };
});

vi.mock("../../../src/services/cacheService.js", () => ({
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

let server: FastifyInstance;
let sqlFnRef: ReturnType<typeof vi.fn>;

function mockSuccessfulInsert(email: string, extras: Record<string, unknown> = {}) {
  sqlFnRef.mockImplementation((strings: TemplateStringsArray) => {
    const q = strings[0] ?? "";
    if (q.includes("WHERE email =")) return Promise.resolve([]);
    if (q.includes("INSERT INTO _postgrify_auth.users")) {
      return Promise.resolve([
        {
          id: "new-uuid-1",
          email,
          email_verified: false,
          role: "viewer",
          created_at: "2026-03-01T00:00:00.000Z",
          metadata: {},
          provider: "email",
          full_name: extras.full_name ?? null,
          is_active: true,
        },
      ]);
    }
    return Promise.resolve([]);
  });
}

beforeAll(async () => {
  server = Fastify({ logger: false });

  const { PoolManager } = await import("../../../src/services/poolManager.js");
  const { CacheService } = await import("../../../src/services/cacheService.js");
  const jwtSvc = new JwtService(JWT_SECRET);

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

  const { authSignupRoute } = await import("../../../src/routes/db/auth/signup.js");
  await server.register(authSignupRoute);
  await server.ready();
});

afterAll(async () => {
  await server.close();
  vi.unstubAllEnvs();
});

beforeEach(() => {
  vi.clearAllMocks();
  sqlFnRef.mockResolvedValue([]);
  mockGetAuthSetting.mockImplementation((_sql: unknown, key: string, def: string) => {
    if (key === "email_signup_enabled") return Promise.resolve("true");
    if (key === "email_verify_required") return Promise.resolve("false");
    return Promise.resolve(def);
  });
  mockSendEmail.mockResolvedValue(undefined);
});

describe("POST /:database/auth/signup", () => {
  it("C-10: verify off → 200 + session tokens", async () => {
    mockSuccessfulInsert("newuser@example.com");

    const res = await server.inject({
      method: "POST",
      url: "/testdb/auth/signup",
      payload: { email: "newuser@example.com", password: "password123" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.access_token).toEqual(expect.any(String));
    expect(body.access_token.length).toBeGreaterThan(10);
    expect(body.refresh_token).toEqual(expect.any(String));
    expect(body.token_type).toBe("bearer");
    expect(typeof body.expires_in).toBe("number");
    expect(body.user).toMatchObject({
      email: "newuser@example.com",
      role: "authenticated",
      aud: "authenticated",
    });
    expect(body.email_verify_sent).toBe(true);
    expect(body).not.toHaveProperty("ok");
  });

  it("Signup email_signup_enabled=false → 403", async () => {
    mockGetAuthSetting.mockImplementation((_sql: unknown, key: string, def: string) => {
      if (key === "email_signup_enabled") return Promise.resolve("false");
      return Promise.resolve(def);
    });

    const res = await server.inject({
      method: "POST",
      url: "/testdb/auth/signup",
      payload: { email: "test@example.com", password: "password123" },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error).toContain("Sign-up disabled");
  });

  it("Duplicate email → 409 Email already registered", async () => {
    sqlFnRef.mockImplementation((strings: TemplateStringsArray) => {
      const q = strings[0] ?? "";
      if (q.includes("WHERE email =")) {
        return Promise.resolve([{ id: "existing-uuid" }]);
      }
      return Promise.resolve([]);
    });

    const res = await server.inject({
      method: "POST",
      url: "/testdb/auth/signup",
      payload: { email: "existing@example.com", password: "password123" },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toContain("already registered");
  });

  it("Kısa şifre (< 8 karakter) → 400 validation", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/testdb/auth/signup",
      payload: { email: "test@example.com", password: "short" },
    });

    expect(res.statusCode).toBe(400);
  });

  it("Geçersiz email formatı → 400 validation", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/testdb/auth/signup",
      payload: { email: "not-an-email", password: "password123" },
    });

    expect(res.statusCode).toBe(400);
  });

  it("email_verify_required=true → empty tokens, same shape", async () => {
    mockGetAuthSetting.mockImplementation((_sql: unknown, key: string, def: string) => {
      if (key === "email_signup_enabled") return Promise.resolve("true");
      if (key === "email_verify_required") return Promise.resolve("true");
      return Promise.resolve(def);
    });
    mockSuccessfulInsert("verify@example.com");

    const res = await server.inject({
      method: "POST",
      url: "/testdb/auth/signup",
      payload: { email: "verify@example.com", password: "password123" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.access_token).toBe("");
    expect(body.refresh_token).toBe("");
    expect(body.token_type).toBe("bearer");
    expect(body.user.email_confirmed_at).toBeNull();
    expect(body.email_verify_sent).toBe(true);
    expect(body.message).toMatch(/verify/i);
  });

  it("data.full_name Supabase field → user_metadata", async () => {
    mockSuccessfulInsert("named@example.com", { full_name: "Test User" });

    const res = await server.inject({
      method: "POST",
      url: "/testdb/auth/signup",
      payload: {
        email: "named@example.com",
        password: "password123",
        data: { full_name: "Test User", plan: "free" },
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().user.user_metadata).toMatchObject({
      full_name: "Test User",
      plan: "free",
    });
    expect(res.json().user.user_metadata).not.toHaveProperty("verification_token");
  });
});
