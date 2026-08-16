/**
 * C-07 — POST /db/:database/auth/login GoTrue snake_case session
 *
 * Refs:
 * - should-corrected-endpoints.md C-07
 * - https://supabase.com/docs/guides/auth/users
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

vi.mock("../../../src/services/emailService.js", () => ({
  sendEmail: vi.fn().mockResolvedValue(undefined),
  buildVerifyEmail: vi.fn().mockReturnValue({ to: "x", subject: "x", html: "x" }),
  buildPasswordResetEmail: vi.fn().mockReturnValue({ to: "x", subject: "x", html: "x" }),
  buildMagicLinkEmail: vi.fn().mockReturnValue({ to: "x", subject: "x", html: "x" }),
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

  const { authTokensRoute } = await import("../../../src/routes/db/auth/tokens.js");
  await server.register(authTokensRoute);
  await server.ready();
});

afterAll(async () => {
  await server.close();
});

beforeEach(() => {
  vi.clearAllMocks();
  sqlFnRef.mockResolvedValue([]);
  mockVerifyPassword.mockResolvedValue(true);
  mockGetAuthSetting.mockResolvedValue("false");
});

describe("C-07 login session shape", () => {
  it("returns snake_case GoTrue fields + enriched user", async () => {
    const created = "2026-01-15T12:00:00.000Z";
    sqlFnRef
      .mockResolvedValueOnce([
        {
          id: "user-uuid-1",
          email: "test@example.com",
          password_hash: "$hashed$",
          role: "editor",
          is_active: true,
          email_verified: true,
          created_at: created,
          metadata: { theme: "dark" },
          provider: "email",
          full_name: "Test User",
          avatar_url: null,
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const res = await server.inject({
      method: "POST",
      url: "/testdb/auth/login",
      payload: { email: "test@example.com", password: "password123" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.access_token).toEqual(expect.any(String));
    expect(body.refresh_token).toEqual(expect.any(String));
    expect(body.token_type).toBe("bearer");
    expect(body.expires_in).toEqual(expect.any(Number));
    expect(body.expires_at).toBeGreaterThanOrEqual(Math.floor(Date.now() / 1000) + body.expires_in - 2);
    expect(body.expires_at).toBeLessThanOrEqual(Math.floor(Date.now() / 1000) + body.expires_in + 2);
    expect(body).not.toHaveProperty("accessToken");
    expect(body.user).toMatchObject({
      id: "user-uuid-1",
      aud: "authenticated",
      role: "authenticated",
      email: "test@example.com",
      email_confirmed_at: created,
      created_at: created,
      updated_at: created,
      app_metadata: {
        provider: "email",
        providers: ["email"],
        role: "editor",
        is_active: true,
      },
      user_metadata: { theme: "dark", full_name: "Test User" },
    });
  });

  it("email_confirmed_at is null when email not verified", async () => {
    sqlFnRef
      .mockResolvedValueOnce([
        {
          id: "user-uuid-2",
          email: "unverified@example.com",
          password_hash: "$hashed$",
          role: "viewer",
          is_active: true,
          email_verified: false,
          created_at: "2026-02-01T00:00:00.000Z",
          metadata: {},
          provider: "email",
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const res = await server.inject({
      method: "POST",
      url: "/testdb/auth/login",
      payload: { email: "unverified@example.com", password: "password123" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().user.email_confirmed_at).toBeNull();
  });
});
