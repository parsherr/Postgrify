/**
 * E-38 admin get user by id tests.
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

const MOCK_USER = {
  id: USER_ID,
  email: "ada@ex.com",
  role: "editor",
  is_active: true,
  created_at: "2024-06-01T00:00:00.000Z",
  last_login: "2024-06-02T12:00:00.000Z",
  email_verified: true,
  full_name: "Ada",
  avatar_url: null,
  provider: "email",
  provider_id: null,
  metadata: {
    reset_token: "SECRET",
    theme: "dark",
  },
};

const MOCK_SESSIONS = [
  {
    id: "22222222-2222-4222-8222-222222222222",
    created_at: "2024-06-02T12:00:00.000Z",
    expires_at: "2024-06-09T12:00:00.000Z",
    ip: "127.0.0.1",
    user_agent: "vitest",
    revoked: false,
  },
];

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

  const { authAdminUsersRoute } = await import(
    "../../../src/routes/db/auth/adminUsers.js"
  );
  await server.register(authAdminUsersRoute);
  await server.ready();
});

afterAll(async () => {
  await server.close();
});

beforeEach(() => {
  vi.clearAllMocks();
  sqlFnRef.mockImplementation(async (strings: TemplateStringsArray) => {
    const q = strings.join(" ");
    if (q.includes("FROM _postgrify_auth.sessions")) return MOCK_SESSIONS;
    if (q.includes("FROM _postgrify_auth.users")) return [MOCK_USER];
    return [];
  });
});

describe("GET /:database/auth/admin/users/:id (E-38)", () => {
  it("admin token → GoTrue-shaped user + sessions", async () => {
    const res = await server.inject({
      method: "GET",
      url: `/testdb/auth/admin/users/${USER_ID}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBe(USER_ID);
    expect(body.email).toBe("ada@ex.com");
    expect(body.role).toBe("authenticated");
    expect(body.app_metadata.role).toBe("editor");
    expect(body.user_metadata.theme).toBe("dark");
    expect(body.user_metadata.reset_token).toBeUndefined();
    expect(body.identities).toHaveLength(1);
    expect(body.identities[0].provider).toBe("email");
    expect(body.factors).toEqual([]);
    expect(body.sessions).toHaveLength(1);
    expect(body.sessions[0].id).toBe(MOCK_SESSIONS[0].id);
    expect(body.last_sign_in_at).toBeTruthy();
  });

  it("schema DB token → 200", async () => {
    const res = await server.inject({
      method: "GET",
      url: `/testdb/auth/admin/users/${USER_ID}`,
      headers: { authorization: `Bearer ${schemaToken}` },
    });
    expect(res.statusCode).toBe(200);
  });

  it("read-only DB token → 403", async () => {
    const res = await server.inject({
      method: "GET",
      url: `/testdb/auth/admin/users/${USER_ID}`,
      headers: { authorization: `Bearer ${readToken}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it("missing token → 401", async () => {
    const res = await server.inject({
      method: "GET",
      url: `/testdb/auth/admin/users/${USER_ID}`,
    });
    expect(res.statusCode).toBe(401);
  });

  it("invalid uuid → 400", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/testdb/auth/admin/users/not-a-uuid",
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(400);
  });

  it("unknown user → 404", async () => {
    sqlFnRef.mockImplementation(async (strings: TemplateStringsArray) => {
      const q = strings.join(" ");
      if (q.includes("FROM _postgrify_auth.users")) return [];
      return [];
    });
    const res = await server.inject({
      method: "GET",
      url: `/testdb/auth/admin/users/${USER_ID}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(404);
  });
});
