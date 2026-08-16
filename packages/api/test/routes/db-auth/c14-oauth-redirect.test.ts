/**
 * C-14 — OAuth initiate redirect_to + scopes
 */

import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from "vitest";
import Fastify, { type FastifyInstance, type FastifyRequest, type FastifyReply } from "fastify";
import { JwtService } from "../../../src/services/jwtService.js";
import { getAuthUrl } from "../../../src/services/oauthService.js";

const JWT_SECRET = "test-secret-must-be-at-least-32-characters";
const APP_URL = "http://localhost:5173";

vi.stubEnv("JWT_SECRET", JWT_SECRET);
vi.stubEnv("APP_URL", APP_URL);
vi.stubEnv("REDIS_URL", "");

const mockGetAuthSetting = vi.fn();

vi.mock("../../../src/routes/db/auth/provision.js", () => ({
  ensureAuthSchema: vi.fn().mockResolvedValue(undefined),
  getApiKey: vi.fn().mockResolvedValue("k"),
  getAuthSetting: mockGetAuthSetting,
  insertAuditLog: vi.fn().mockResolvedValue(undefined),
  provisionApiKey: vi.fn().mockResolvedValue("k"),
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
  sendEmail: vi.fn(),
  buildVerifyEmail: vi.fn(),
  buildPasswordResetEmail: vi.fn(),
  buildMagicLinkEmail: vi.fn(),
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
    if (!payload) return reply.status(401).send({ error: "Invalid" });
    req.user = payload;
  });
  server.decorate("authenticateAdmin", async () => {});

  const { authOAuthRoute } = await import("../../../src/routes/db/auth/oauth.js");
  await server.register(authOAuthRoute);
  await server.ready();
});

afterAll(async () => {
  await server.close();
  vi.unstubAllEnvs();
});

beforeEach(() => {
  vi.clearAllMocks();
  sqlFnRef.mockResolvedValue([]);
  mockGetAuthSetting.mockResolvedValue("true");
});

describe("getAuthUrl scopes (C-14)", () => {
  const cfg = {
    clientId: "cid",
    clientSecret: "sec",
    redirectUri: "http://localhost:6880/cb",
  };

  it("google default scopes", () => {
    const url = new URL(getAuthUrl("google", cfg, "st"));
    expect(url.searchParams.get("scope")).toBe("openid email profile");
  });

  it("google custom scopes", () => {
    const url = new URL(getAuthUrl("google", cfg, "st", "openid email"));
    expect(url.searchParams.get("scope")).toBe("openid email");
  });

  it("github custom scopes", () => {
    const url = new URL(getAuthUrl("github", cfg, "st", "read:user"));
    expect(url.searchParams.get("scope")).toBe("read:user");
  });
});

describe("C-14 initiate", () => {
  it("302 to google with scopes + accepts redirect_to", async () => {
    sqlFnRef.mockResolvedValueOnce([
      {
        client_id: "g-cid",
        client_secret: "g-sec",
        redirect_uri: "http://localhost:6880/db/testdb/auth/oauth/google/callback",
      },
    ]);

    const res = await server.inject({
      method: "GET",
      url:
        "/testdb/auth/oauth/google?redirect_to=" +
        encodeURIComponent(`${APP_URL}/dash`) +
        "&scopes=" +
        encodeURIComponent("openid email"),
    });

    expect(res.statusCode).toBe(302);
    const loc = res.headers.location as string;
    expect(loc).toContain("accounts.google.com");
    expect(loc).toMatch(/scope=openid[+ ]email/);
  });

  it("403 when oauth disabled", async () => {
    mockGetAuthSetting.mockResolvedValue("false");
    const res = await server.inject({
      method: "GET",
      url: "/testdb/auth/oauth/google",
    });
    expect(res.statusCode).toBe(403);
  });
});
