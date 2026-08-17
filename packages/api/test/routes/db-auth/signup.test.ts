/**
 * Signup route tests.
 *
 * POST /:database/auth/signup
 */

import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from "vitest";
import Fastify, { type FastifyInstance, type FastifyRequest, type FastifyReply } from "fastify";
import { JwtService } from "../../../src/services/jwtService.js";

const JWT_SECRET = "test-secret-must-be-at-least-32-characters";

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
    connect: vi.fn(), disconnect: vi.fn(),
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn(), del: vi.fn(), invalidatePattern: vi.fn(),
    buildKey: (...p: string[]) => `postgrify:${p.join(":")}`,
    redisClient: null,
  })),
  TTL: { ROW_QUERY: 30, SCHEMA: 300, TABLE_LIST: 120, DB_SIZE: 60 },
}));

let server: FastifyInstance;
let sqlFnRef: ReturnType<typeof vi.fn>;

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
});

beforeEach(() => {
  vi.clearAllMocks();
  sqlFnRef.mockResolvedValue([]);
  // Default: signup enabled, verify not required
  mockGetAuthSetting.mockImplementation((_sql: unknown, key: string, def: string) => {
    if (key === "email_signup_enabled") return Promise.resolve("true");
    if (key === "email_verify_required") return Promise.resolve("false");
    return Promise.resolve(def);
  });
  mockSendEmail.mockResolvedValue(undefined);
});

describe("POST /:database/auth/signup", () => {
  it("Successful signup → 201, returns user object", async () => {
    sqlFnRef.mockImplementation((strings: TemplateStringsArray) => {
      const q = strings[0] ?? "";
      // Email uniqueness check → none found
      if (q.includes("WHERE email =")) return Promise.resolve([]);
      // INSERT user → returns
      if (q.includes("INSERT INTO _postgrify_auth.users")) {
        return Promise.resolve([{
          id: "new-uuid-1",
          email: "newuser@example.com",
          email_verified: false,
          role: "viewer",
        }]);
      }
      return Promise.resolve([]);
    });

    const res = await server.inject({
      method: "POST",
      url: "/testdb/auth/signup",
      payload: { email: "newuser@example.com", password: "password123" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    // GoTrue session shape (C-10)
    expect(body.access_token).toEqual(expect.any(String));
    expect(body.token_type).toBe("bearer");
    expect(body.user).toMatchObject({
      email: "newuser@example.com",
    });
  });

  it("Signup with email_signup_enabled=false → 403", async () => {
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
      // Email already exists
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

  it("Short password (< 8 characters) → 400 validation", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/testdb/auth/signup",
      payload: { email: "test@example.com", password: "short" },
    });

    expect(res.statusCode).toBe(400);
  });

  it("Invalid email format → 400 validation", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/testdb/auth/signup",
      payload: { email: "not-an-email", password: "password123" },
    });

    expect(res.statusCode).toBe(400);
  });

  it("email_verify_required=true → response has the email_verify_sent field", async () => {
    mockGetAuthSetting.mockImplementation((_sql: unknown, key: string, def: string) => {
      if (key === "email_signup_enabled") return Promise.resolve("true");
      if (key === "email_verify_required") return Promise.resolve("true");
      return Promise.resolve(def);
    });
    mockSendEmail.mockResolvedValue(undefined);

    sqlFnRef.mockImplementation((strings: TemplateStringsArray) => {
      const q = strings[0] ?? "";
      if (q.includes("WHERE email =")) return Promise.resolve([]);
      if (q.includes("INSERT INTO _postgrify_auth.users")) {
        return Promise.resolve([{
          id: "new-uuid-2",
          email: "verify@example.com",
          email_verified: false,
          role: "viewer",
        }]);
      }
      return Promise.resolve([]);
    });

    const res = await server.inject({
      method: "POST",
      url: "/testdb/auth/signup",
      payload: { email: "verify@example.com", password: "password123" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty("email_verify_sent");
    expect(body.message).toContain("verify your email");
  });

  it("signup with full_name → 200", async () => {
    sqlFnRef.mockImplementation((strings: TemplateStringsArray) => {
      const q = strings[0] ?? "";
      if (q.includes("WHERE email =")) return Promise.resolve([]);
      if (q.includes("INSERT INTO _postgrify_auth.users")) {
        return Promise.resolve([{
          id: "new-uuid-3",
          email: "named@example.com",
          email_verified: false,
          role: "viewer",
        }]);
      }
      return Promise.resolve([]);
    });

    const res = await server.inject({
      method: "POST",
      url: "/testdb/auth/signup",
      payload: { email: "named@example.com", password: "password123", full_name: "Test User" },
    });

    expect(res.statusCode).toBe(200);
  });
});