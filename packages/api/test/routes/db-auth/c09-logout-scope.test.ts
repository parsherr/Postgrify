/**
 * C-09 — POST /db/:database/auth/logout scope=global|local|others
 */

import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from "vitest";
import Fastify, { type FastifyInstance, type FastifyRequest, type FastifyReply } from "fastify";
import { JwtService } from "../../../src/services/jwtService.js";

const JWT_SECRET = "test-secret-must-be-at-least-32-characters";
vi.stubEnv("JWT_SECRET", JWT_SECRET);

const mockInsertAuditLog = vi.fn();

vi.mock("../../../src/routes/db/auth/provision.js", () => ({
  ensureAuthSchema: vi.fn().mockResolvedValue(undefined),
  getApiKey: vi.fn().mockResolvedValue("test-api-key"),
  getAuthSetting: vi.fn().mockResolvedValue("false"),
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
let accessToken: string;

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

  accessToken = await jwtSvc.signDbUserToken(
    "testdb",
    "user-uuid-1",
    "test@example.com",
    "viewer"
  );
});

afterAll(async () => {
  await server.close();
  vi.unstubAllEnvs();
});

beforeEach(() => {
  vi.clearAllMocks();
  sqlFnRef.mockResolvedValue([]);
});

describe("C-09 logout", () => {
  it("local with refresh_token → 204", async () => {
    sqlFnRef
      .mockResolvedValueOnce([{ user_id: "user-uuid-1" }])
      .mockResolvedValueOnce([]);

    const res = await server.inject({
      method: "POST",
      url: "/testdb/auth/logout",
      payload: { refresh_token: "rt" },
    });
    expect(res.statusCode).toBe(204);
  });

  it("global with Bearer → 204 and audits", async () => {
    sqlFnRef.mockResolvedValueOnce([]); // family revoke

    const res = await server.inject({
      method: "POST",
      url: "/testdb/auth/logout?scope=global",
      headers: { Authorization: `Bearer ${accessToken}` },
      payload: {},
    });
    expect(res.statusCode).toBe(204);
    expect(mockInsertAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      "logout",
      "user-uuid-1",
      expect.objectContaining({ metadata: { scope: "global" } })
    );
  });

  it("global without identity → 401", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/testdb/auth/logout?scope=global",
      payload: {},
    });
    expect(res.statusCode).toBe(401);
  });

  it("others without refresh_token → 400", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/testdb/auth/logout?scope=others",
      headers: { Authorization: `Bearer ${accessToken}` },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("others with Bearer + refresh → 204", async () => {
    sqlFnRef
      .mockResolvedValueOnce([{ user_id: "user-uuid-1" }])
      .mockResolvedValueOnce([]);

    const res = await server.inject({
      method: "POST",
      url: "/testdb/auth/logout?scope=others",
      headers: { Authorization: `Bearer ${accessToken}` },
      payload: { refreshToken: "keep-me" },
    });
    expect(res.statusCode).toBe(204);
  });
});
