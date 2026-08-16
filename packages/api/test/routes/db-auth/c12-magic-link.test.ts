/**
 * C-12 — GET /db/:database/auth/magic-link/verify GoTrue session
 */

import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from "vitest";
import Fastify, { type FastifyInstance, type FastifyRequest, type FastifyReply } from "fastify";
import { JwtService } from "../../../src/services/jwtService.js";

const JWT_SECRET = "test-secret-must-be-at-least-32-characters";
const APP_URL = "http://localhost:5173";

vi.stubEnv("JWT_SECRET", JWT_SECRET);
vi.stubEnv("APP_URL", APP_URL);

vi.mock("../../../src/routes/db/auth/provision.js", () => ({
  ensureAuthSchema: vi.fn().mockResolvedValue(undefined),
  getApiKey: vi.fn().mockResolvedValue("test-api-key"),
  getAuthSetting: vi.fn().mockImplementation((_s: unknown, key: string, def: string) => {
    if (key === "magic_link_ttl_minutes") return Promise.resolve("15");
    return Promise.resolve(def);
  }),
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

const validUser = {
  id: "user-1",
  email: "u@example.com",
  role: "viewer",
  is_active: true,
  created_at: "2026-01-01T00:00:00.000Z",
  metadata: {},
  provider: "email",
  full_name: null,
  avatar_url: null,
  magic_token_exp: new Date(Date.now() + 3600_000).toISOString(),
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

  const { authMagicLinkRoute } = await import("../../../src/routes/db/auth/magicLink.js");
  await server.register(authMagicLinkRoute);
  await server.ready();
});

afterAll(async () => {
  await server.close();
  vi.unstubAllEnvs();
});

beforeEach(() => {
  vi.clearAllMocks();
  sqlFnRef.mockResolvedValue([]);
});

describe("C-12 magic-link/verify", () => {
  it("returns GoTrue snake_case session", async () => {
    sqlFnRef
      .mockResolvedValueOnce([validUser])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const res = await server.inject({
      method: "GET",
      url: "/testdb/auth/magic-link/verify?token=abc",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.access_token).toEqual(expect.any(String));
    expect(body.token_type).toBe("bearer");
    expect(body.user.role).toBe("authenticated");
    expect(body).not.toHaveProperty("accessToken");
  });

  it("redirect_to → 302 fragment type=magiclink", async () => {
    sqlFnRef
      .mockResolvedValueOnce([validUser])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const res = await server.inject({
      method: "GET",
      url: `/testdb/auth/magic-link/verify?token=abc&redirect_to=${encodeURIComponent(`${APP_URL}/in`)}`,
    });
    expect(res.statusCode).toBe(302);
    const loc = res.headers.location as string;
    expect(loc).toContain(`${APP_URL}/in#`);
    expect(loc).toContain("type=magiclink");
    expect(loc).toContain("access_token=");
  });
});
