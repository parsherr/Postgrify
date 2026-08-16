/**
 * E-39 admin generate-link tests.
 */

import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from "vitest";
import Fastify, {
  type FastifyInstance,
  type FastifyRequest,
  type FastifyReply,
} from "fastify";
import { JwtService } from "../../../src/services/jwtService.js";

const JWT_SECRET = "test-secret-must-be-at-least-32-characters";
const USER_ID = "11111111-1111-4111-8111-111111111111";

vi.stubEnv("APP_URL", "http://localhost:5173");

vi.mock("../../../src/routes/db/auth/provision.js", () => ({
  ensureAuthSchema: vi.fn().mockResolvedValue(undefined),
  getApiKey: vi.fn().mockResolvedValue("test-api-key"),
  getAuthSetting: vi.fn().mockResolvedValue("15"),
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

let server: FastifyInstance;
let jwtSvc: JwtService;
let sqlFnRef: ReturnType<typeof vi.fn>;
let adminToken: string;
let schemaToken: string;
let readToken: string;

beforeAll(async () => {
  jwtSvc = new JwtService(JWT_SECRET);
  adminToken = await jwtSvc.signAdminToken();
  schemaToken = await jwtSvc.signDbToken("testdb", ["schema"]);
  readToken = await jwtSvc.signDbToken("testdb", ["read"]);

  server = Fastify({ logger: false });
  const { PoolManager } = await import("../../../src/services/poolManager.js");
  const { CacheService } = await import("../../../src/services/cacheService.js");
  const { default: postgres } = await import("postgres");
  sqlFnRef = (postgres as unknown as ReturnType<typeof vi.fn>)();

  server.decorate("poolManager", new PoolManager({} as never));
  server.decorate("cache", new CacheService());
  server.decorateRequest("user", null);
  server.decorateRequest("dbName", null);

  server.decorate("authenticate", async (req: FastifyRequest, reply: FastifyReply) => {
    const auth = req.headers.authorization;
    if (!auth?.startsWith("Bearer ")) {
      return reply.status(401).send({ error: "Unauthorized" });
    }
    const payload = await jwtSvc.verifyAdminOrDb(auth.slice(7));
    if (!payload) return reply.status(401).send({ error: "Invalid token" });
    req.user = payload;
    if (!req.dbName) {
      req.dbName = (req.params as Record<string, string>)?.database;
    }
  });
  server.decorate("authenticateAdmin", async () => {});
  server.decorate("jwtService", jwtSvc);

  const { authGenerateLinkRoute } = await import(
    "../../../src/routes/db/auth/generateLink.js"
  );
  await server.register(authGenerateLinkRoute);
  await server.ready();
});

afterAll(async () => {
  await server.close();
});

beforeEach(() => {
  vi.clearAllMocks();
  sqlFnRef.mockImplementation(async (strings: TemplateStringsArray) => {
    const q = strings.join(" ");
    if (q.includes("INSERT INTO _postgrify_auth.users")) {
      return [
        {
          id: USER_ID,
          email: "new@ex.com",
          is_active: true,
          email_verified: false,
          metadata: {},
        },
      ];
    }
    if (q.includes("SELECT id, email, is_active")) {
      return [
        {
          id: USER_ID,
          email: "ada@ex.com",
          is_active: true,
          email_verified: true,
          // Legacy double-encoded string metadata (live smoke_db shape)
          metadata: JSON.stringify({ full_name: "Ada" }),
        },
      ];
    }
    return [];
  });
});

describe("POST /:database/auth/admin/generate-link (E-39)", () => {
  it("magiclink → action_link + hashed_token", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/testdb/auth/admin/generate-link",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { type: "magiclink", email: "ada@ex.com" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.action_link).toContain("/auth/magic-link/verify?token=");
    expect(body.hashed_token).toMatch(/^[a-f0-9]{64}$/);
    expect(body.email_otp).toMatch(/^\d{6}$/);
    expect(body.verification_type).toBe("magiclink");
    expect(body.expires_at).toBeGreaterThan(Math.floor(Date.now() / 1000));
    expect(body.user.id).toBe(USER_ID);
  });

  it("recovery for existing user", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/testdb/auth/admin/generate-link",
      headers: { authorization: `Bearer ${schemaToken}` },
      payload: {
        type: "recovery",
        email: "ada@ex.com",
        redirect_to: "http://localhost:5173/app",
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.action_link).toContain("/reset-password?");
    expect(body.redirect_to).toContain("localhost:5173");
  });

  it("recovery missing user → 404", async () => {
    sqlFnRef.mockResolvedValue([]);
    const res = await server.inject({
      method: "POST",
      url: "/testdb/auth/admin/generate-link",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { type: "recovery", email: "ghost@ex.com" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("phone_change → 400", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/testdb/auth/admin/generate-link",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { type: "phone_change", email: "ada@ex.com" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("read token → 403", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/testdb/auth/admin/generate-link",
      headers: { authorization: `Bearer ${readToken}` },
      payload: { type: "magiclink", email: "ada@ex.com" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("no token → 401", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/testdb/auth/admin/generate-link",
      payload: { type: "magiclink", email: "ada@ex.com" },
    });
    expect(res.statusCode).toBe(401);
  });
});
