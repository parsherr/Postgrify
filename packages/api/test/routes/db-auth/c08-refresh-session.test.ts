/**
 * C-08 — POST /db/:database/auth/refresh GoTrue session + reuse detection
 */

import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from "vitest";
import Fastify, { type FastifyInstance, type FastifyRequest, type FastifyReply } from "fastify";
import { JwtService } from "../../../src/services/jwtService.js";

const JWT_SECRET = "test-secret-must-be-at-least-32-characters";

vi.stubEnv("JWT_SECRET", JWT_SECRET);
vi.stubEnv("REFRESH_TOKEN_REUSE_INTERVAL_SECONDS", "10");

const mockGetAuthSetting = vi.fn();
const mockInsertAuditLog = vi.fn();

vi.mock("../../../src/routes/db/auth/provision.js", () => ({
  ensureAuthSchema: vi.fn().mockResolvedValue(undefined),
  getApiKey: vi.fn().mockResolvedValue("test-api-key"),
  getAuthSetting: mockGetAuthSetting,
  insertAuditLog: mockInsertAuditLog,
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

const activeUserSession = {
  id: "session-uuid-1",
  user_id: "user-uuid-1",
  expires_at: new Date(Date.now() + 86400000).toISOString(),
  email: "test@example.com",
  role: "viewer",
  is_active: true,
  email_verified: true,
  created_at: "2026-01-01T00:00:00.000Z",
  metadata: {},
  provider: "email",
};

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
  vi.unstubAllEnvs();
});

beforeEach(() => {
  vi.clearAllMocks();
  sqlFnRef.mockResolvedValue([]);
  mockGetAuthSetting.mockResolvedValue("false");
});

describe("C-08 refresh", () => {
  it("returns GoTrue snake_case session with user", async () => {
    sqlFnRef
      .mockResolvedValueOnce([{ ...activeUserSession }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const res = await server.inject({
      method: "POST",
      url: "/testdb/auth/refresh",
      payload: { refresh_token: "tok" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.access_token).toEqual(expect.any(String));
    expect(body.refresh_token).toEqual(expect.any(String));
    expect(body.token_type).toBe("bearer");
    expect(typeof body.expires_in).toBe("number");
    expect(body.user.role).toBe("authenticated");
    expect(body).not.toHaveProperty("accessToken");
  });

  it("grace window: revoked token within interval can rotate again", async () => {
    sqlFnRef
      .mockResolvedValueOnce([]) // active miss
      .mockResolvedValueOnce([
        {
          ...activeUserSession,
          revoked_at: new Date().toISOString(),
        },
      ])
      .mockResolvedValueOnce([]) // update revoked (no-op if already)
      .mockResolvedValueOnce([]); // insert

    const res = await server.inject({
      method: "POST",
      url: "/testdb/auth/refresh",
      payload: { refreshToken: "already-used" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().access_token).toEqual(expect.any(String));
    expect(mockInsertAuditLog).not.toHaveBeenCalledWith(
      expect.anything(),
      "refresh_token_reuse",
      expect.anything(),
      expect.anything()
    );
  });

  it("reuse outside grace revokes family and returns 401", async () => {
    sqlFnRef
      .mockResolvedValueOnce([]) // active miss
      .mockResolvedValueOnce([
        {
          ...activeUserSession,
          revoked_at: new Date(Date.now() - 60_000).toISOString(),
        },
      ])
      .mockResolvedValueOnce([]); // family revoke update

    const res = await server.inject({
      method: "POST",
      url: "/testdb/auth/refresh",
      payload: { refresh_token: "stolen" },
    });
    expect(res.statusCode).toBe(401);
    expect(mockInsertAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      "refresh_token_reuse",
      "user-uuid-1",
      expect.objectContaining({ metadata: { reason: "reuse_outside_grace" } })
    );
  });
});
