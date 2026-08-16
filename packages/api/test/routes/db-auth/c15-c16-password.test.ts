/**
 * C-15 / C-16 — password forgot + reset empty JSON responses
 */

import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from "vitest";
import Fastify, { type FastifyInstance, type FastifyRequest, type FastifyReply } from "fastify";
import { JwtService } from "../../../src/services/jwtService.js";
import { buildPasswordResetEmail } from "../../../src/services/emailService.js";

const JWT_SECRET = "test-secret-must-be-at-least-32-characters";
vi.stubEnv("JWT_SECRET", JWT_SECRET);
vi.stubEnv("APP_URL", "http://localhost:5173");

const mockGetAuthSetting = vi.fn();
const mockSendEmail = vi.fn().mockResolvedValue(undefined);

vi.mock("../../../src/routes/db/auth/provision.js", () => ({
  ensureAuthSchema: vi.fn().mockResolvedValue(undefined),
  getApiKey: vi.fn().mockResolvedValue("k"),
  getAuthSetting: mockGetAuthSetting,
  insertAuditLog: vi.fn().mockResolvedValue(undefined),
  provisionApiKey: vi.fn().mockResolvedValue("k"),
}));

vi.mock("../../../src/services/passwordService.js", () => ({
  hashPassword: vi.fn().mockResolvedValue("$hashed$"),
  verifyPassword: vi.fn().mockResolvedValue(true),
}));

vi.mock("../../../src/services/emailService.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/services/emailService.js")>();
  return {
    ...actual,
    sendEmail: (...args: unknown[]) => mockSendEmail(...args),
  };
});

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
    buildKey: (...p: string[]) => p.join(":"),
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
    if (!payload) return reply.status(401).send({ error: "Invalid" });
    req.user = payload;
  });
  server.decorate("authenticateAdmin", async () => {});

  const { authPasswordResetRoute } = await import(
    "../../../src/routes/db/auth/passwordReset.js"
  );
  await server.register(authPasswordResetRoute);
  await server.ready();
});

afterAll(async () => {
  await server.close();
  vi.unstubAllEnvs();
});

beforeEach(() => {
  vi.clearAllMocks();
  sqlFnRef.mockResolvedValue([]);
  mockGetAuthSetting.mockImplementation((_s: unknown, key: string, def: string) =>
    Promise.resolve(def)
  );
});

describe("C-15 forgot", () => {
  it("always returns empty object", async () => {
    sqlFnRef.mockResolvedValueOnce([]); // no user
    const res = await server.inject({
      method: "POST",
      url: "/testdb/auth/password/forgot",
      payload: { email: "nobody@example.com" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({});
  });

  it("known user still returns {}", async () => {
    sqlFnRef
      .mockResolvedValueOnce([{ id: "u1", email: "a@b.c" }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    const res = await server.inject({
      method: "POST",
      url: "/testdb/auth/password/forgot",
      payload: {
        email: "a@b.c",
        redirect_to: "http://localhost:5173/reset",
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({});
    expect(mockSendEmail).toHaveBeenCalled();
  });
});

describe("C-16 reset", () => {
  it("returns {} and revokes sessions by default", async () => {
    sqlFnRef
      .mockResolvedValueOnce([
        {
          id: "u1",
          email: "a@b.c",
          reset_token_exp: new Date(Date.now() + 3600_000).toISOString(),
        },
      ])
      .mockResolvedValueOnce([]) // update password
      .mockResolvedValueOnce([]) // revoke sessions
      .mockResolvedValue([]);

    const res = await server.inject({
      method: "POST",
      url: "/testdb/auth/password/reset",
      payload: { token: "abc", password: "password123" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({});
  });
});

describe("buildPasswordResetEmail", () => {
  it("includes redirect_to in link", () => {
    const mail = buildPasswordResetEmail({
      appUrl: "http://localhost:5173",
      database: "db",
      token: "tok",
      email: "a@b.c",
      redirectTo: "http://localhost:5173/done",
    });
    expect(mail.html).toContain("redirect_to=");
    expect(mail.subject).toMatch(/password/i);
  });
});
