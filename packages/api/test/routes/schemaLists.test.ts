/**
 * E-64 / E-68 / E-73 / E-79 / E-82 schema list route tests.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { JwtService } from "../../src/services/jwtService.js";

const JWT_SECRET = "test-secret-must-be-at-least-32-characters";

vi.stubEnv("JWT_SECRET", JWT_SECRET);
vi.stubEnv("ADMIN_SECRET", "test-admin-secret-16ch");

const MOCK_SCHEMAS = [
  { name: "public", owner: "postgres" },
  { name: "_postgrify_auth", owner: "postgres" },
];
const MOCK_VIEWS = [
  {
    schema: "public",
    name: "active_users",
    is_materialized: false,
    is_updatable: true,
    definition: "SELECT 1",
  },
];
const MOCK_FUNCS = [
  {
    schema: "public",
    name: "add_nums",
    language: "sql",
    return_type: "integer",
    arguments: "a integer, b integer",
    kind: "function",
  },
];
const MOCK_INDEXES = [
  {
    name: "users_pkey",
    table: "users",
    type: "btree",
    size: "16 kB",
    unique: true,
    primary: true,
    columns: ["id"],
  },
];
const MOCK_ROLES = [
  {
    name: "web_anon",
    is_superuser: false,
    can_login: false,
    member_of: [],
  },
  {
    name: "authenticated",
    is_superuser: false,
    can_login: false,
    member_of: ["web_anon"],
  },
];

vi.mock("postgres", () => {
  const sqlFn = vi.fn((strings: TemplateStringsArray) => {
    const q = strings?.join?.(" ") ?? strings?.[0] ?? "";
    if (q.includes("pg_namespace") && q.includes("pg_get_userbyid")) {
      return Promise.resolve(MOCK_SCHEMAS);
    }
    if (q.includes("pg_get_viewdef")) return Promise.resolve(MOCK_VIEWS);
    if (q.includes("pg_get_function_result")) return Promise.resolve(MOCK_FUNCS);
    if (q.includes("pg_index")) return Promise.resolve(MOCK_INDEXES);
    if (q.includes("pg_roles") && q.includes("rolcanlogin")) {
      return Promise.resolve(MOCK_ROLES);
    }
    return Promise.resolve([]);
  }) as unknown as Record<string, unknown>;
  sqlFn.unsafe = vi.fn().mockResolvedValue([]);
  sqlFn.end = vi.fn().mockResolvedValue(undefined);
  return { default: vi.fn(() => sqlFn) };
});

vi.mock("../../src/services/cacheService.js", () => ({
  CacheService: vi.fn().mockImplementation(() => ({
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
    del: vi.fn().mockResolvedValue(undefined),
    invalidatePattern: vi.fn().mockResolvedValue(undefined),
    buildKey: (...p: string[]) => `postgrify:${p.join(":")}`,
  })),
  TTL: { ROW_QUERY: 30, SCHEMA: 300, TABLE_LIST: 120, DB_SIZE: 60 },
}));

let server: FastifyInstance;
let adminToken: string;
let readToken: string;
let schemaToken: string;

beforeAll(async () => {
  server = Fastify({ logger: false });

  const { PoolManager } = await import("../../src/services/poolManager.js");
  const { CacheService } = await import("../../src/services/cacheService.js");

  server.decorate("poolManager", new PoolManager({} as never));
  server.decorate("cache", new CacheService());
  server.decorateRequest("user", null);
  server.decorateRequest("dbName", null);

  const jwtSvc = new JwtService(JWT_SECRET);

  server.decorate("authenticate", async (req: never, reply: never) => {
    const auth = (req as { headers: Record<string, string> }).headers
      .authorization;
    if (!auth?.startsWith("Bearer ")) {
      return (
        reply as { status: (n: number) => { send: (b: unknown) => void } }
      )
        .status(401)
        .send({ error: "Unauthorized" });
    }
    const payload = await jwtSvc.verify(auth.slice(7));
    if (!payload) {
      return (
        reply as { status: (n: number) => { send: (b: unknown) => void } }
      )
        .status(401)
        .send({ error: "Invalid token" });
    }
    (req as { user: unknown }).user = payload;
  });

  server.decorate("authenticateAdmin", async () => {});
  server.decorate("authenticateAny", async (req: never, reply: never) => {
    return (
      server as never as {
        authenticate: (r: never, rep: never) => Promise<void>;
      }
    ).authenticate(req, reply);
  });

  const { dbRoutes } = await import("../../src/routes/db/index.js");
  await server.register(dbRoutes, { prefix: "/db" });
  await server.ready();

  adminToken = await jwtSvc.signAdminToken();
  readToken = await jwtSvc.signDbToken("project1", ["read"]);
  schemaToken = await jwtSvc.signDbToken("project1", ["schema"]);
});

afterAll(async () => {
  await server.close();
  vi.unstubAllEnvs();
});

describe("GET /db/:database/roles (E-82)", () => {
  it("schema token lists roles", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/db/project1/roles",
      headers: { Authorization: `Bearer ${schemaToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body[0]).toMatchObject({
      name: "web_anon",
      is_superuser: false,
      can_login: false,
    });
    expect(body[0]).toHaveProperty("member_of");
  });

  it("admin token allowed", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/db/project1/roles",
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(200);
  });

  it("read-only DB token denied", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/db/project1/roles",
      headers: { Authorization: `Bearer ${readToken}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it("no token → 401", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/db/project1/roles",
    });
    expect(res.statusCode).toBe(401);
  });
});

describe("GET /db/:database/schemas (E-79)", () => {
  it("schema token lists name + owner", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/db/project1/schemas",
      headers: { Authorization: `Bearer ${schemaToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body[0]).toEqual({ name: "public", owner: "postgres" });
  });
});

describe("GET /db/:database/views (E-64)", () => {
  it("schema token lists views", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/db/project1/views",
      headers: { Authorization: `Bearer ${schemaToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()[0].name).toBe("active_users");
  });

  it("read-only DB token denied", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/db/project1/views",
      headers: { Authorization: `Bearer ${readToken}` },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("GET /db/:database/functions (E-68)", () => {
  it("lists functions", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/db/project1/functions",
      headers: { Authorization: `Bearer ${schemaToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()[0].name).toBe("add_nums");
  });
});

describe("GET /db/:database/indexes (E-73)", () => {
  it("lists indexes", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/db/project1/indexes",
      headers: { Authorization: `Bearer ${schemaToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()[0].name).toBe("users_pkey");
  });
});
