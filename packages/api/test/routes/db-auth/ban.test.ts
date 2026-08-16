/**
 * E-41 admin ban / unban tests.
 */

import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from "vitest";
import Fastify, {
  type FastifyInstance,
  type FastifyRequest,
  type FastifyReply,
} from "fastify";
import { JwtService } from "../../../src/services/jwtService.js";
import { parseBanDuration } from "../../../src/routes/db/auth/ban.js";

const JWT_SECRET = "test-secret-must-be-at-least-32-characters";
const USER_ID = "11111111-1111-4111-8111-111111111111";

vi.mock("../../../src/routes/db/auth/provision.js", () => ({
  ensureAuthSchema: vi.fn().mockResolvedValue(undefined),
  getApiKey: vi.fn().mockResolvedValue("test-api-key"),
  getAuthSetting: vi.fn().mockResolvedValue("true"),
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

describe("parseBanDuration", () => {
  it("parses timed durations", () => {
    const r = parseBanDuration("24h");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.until).toBeInstanceOf(Date);
      expect(r.until!.getTime()).toBeGreaterThan(Date.now());
    }
  });

  it("unbans with none/0", () => {
    expect(parseBanDuration("none")).toEqual({ ok: true, until: null });
    expect(parseBanDuration("0")).toEqual({ ok: true, until: null });
  });

  it("supports permanent", () => {
    const r = parseBanDuration("permanent");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.until?.getUTCFullYear()).toBe(9999);
  });

  it("rejects garbage", () => {
    expect(parseBanDuration("tomorrow").ok).toBe(false);
  });
});

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

  const { authBanRoute } = await import("../../../src/routes/db/auth/ban.js");
  await server.register(authBanRoute);
  await server.ready();
});

afterAll(async () => {
  await server.close();
});

beforeEach(() => {
  vi.clearAllMocks();
  sqlFnRef.mockImplementation(async (strings: TemplateStringsArray) => {
    const q = strings.join(" ");
    if (q.includes("SELECT id FROM _postgrify_auth.users")) {
      return [{ id: USER_ID }];
    }
    if (q.includes("UPDATE _postgrify_auth.users")) {
      return [
        {
          id: USER_ID,
          locked_until: new Date(Date.now() + 24 * 3600_000).toISOString(),
        },
      ];
    }
    if (q.includes("UPDATE _postgrify_auth.sessions")) {
      return [];
    }
    return [];
  });
});

describe("POST /:database/auth/admin/users/:id/ban (E-41)", () => {
  it("bans with 24h → banned_until", async () => {
    const res = await server.inject({
      method: "POST",
      url: `/testdb/auth/admin/users/${USER_ID}/ban`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { ban_duration: "24h" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBe(USER_ID);
    expect(body.banned_until).toBeTruthy();
    expect(new Date(body.banned_until).getTime()).toBeGreaterThan(Date.now());
  });

  it("unban with none → banned_until null", async () => {
    sqlFnRef.mockImplementation(async (strings: TemplateStringsArray) => {
      const q = strings.join(" ");
      if (q.includes("SELECT id FROM")) return [{ id: USER_ID }];
      if (q.includes("UPDATE _postgrify_auth.users")) {
        return [{ id: USER_ID, locked_until: null }];
      }
      return [];
    });
    const res = await server.inject({
      method: "POST",
      url: `/testdb/auth/admin/users/${USER_ID}/ban`,
      headers: { authorization: `Bearer ${schemaToken}` },
      payload: { ban_duration: "none" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ id: USER_ID, banned_until: null });
  });

  it("missing user → 404", async () => {
    sqlFnRef.mockResolvedValue([]);
    const res = await server.inject({
      method: "POST",
      url: `/testdb/auth/admin/users/${USER_ID}/ban`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { ban_duration: "1h" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("invalid duration → 400", async () => {
    const res = await server.inject({
      method: "POST",
      url: `/testdb/auth/admin/users/${USER_ID}/ban`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { ban_duration: "soon" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("read token → 403", async () => {
    const res = await server.inject({
      method: "POST",
      url: `/testdb/auth/admin/users/${USER_ID}/ban`,
      headers: { authorization: `Bearer ${readToken}` },
      payload: { ban_duration: "1h" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("no token → 401", async () => {
    const res = await server.inject({
      method: "POST",
      url: `/testdb/auth/admin/users/${USER_ID}/ban`,
      payload: { ban_duration: "1h" },
    });
    expect(res.statusCode).toBe(401);
  });
});
