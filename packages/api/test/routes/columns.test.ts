/**
 * Column management endpoint tests:
 *   POST   /db/:database/tables/:table/columns
 *   DELETE /db/:database/tables/:table/columns/:col
 *   PATCH  /db/:database/tables/:table/columns/:col
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { JwtService } from "../../src/services/jwtService.js";

const JWT_SECRET = "test-secret-must-be-at-least-32-characters";

vi.stubEnv("JWT_SECRET", JWT_SECRET);
vi.stubEnv("ADMIN_SECRET", "test-admin-secret-16ch");

// sqlFn lives in the module closure — defined here for beforeAll access
const unsafeMock = vi.fn().mockResolvedValue([]);

vi.mock("postgres", () => {
  const sqlFn = vi.fn((strings: TemplateStringsArray) => {
    if (strings?.[0]?.includes("information_schema.tables")) return Promise.resolve([]);
    if (strings?.[0]?.includes("information_schema.columns")) return Promise.resolve([]);
    return Promise.resolve([]);
  }) as unknown as Record<string, unknown>;
  sqlFn.unsafe = unsafeMock;
  sqlFn.end = vi.fn().mockResolvedValue(undefined);
  const ctor = vi.fn(() => sqlFn);
  return { default: ctor };
});

vi.mock("../../src/services/cacheService.js", () => ({
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
let adminToken: string;
let schemaToken: string;
let readToken: string;

beforeAll(async () => {
  server = Fastify({ logger: false });

  const { PoolManager } = await import("../../src/services/poolManager.js");
  const { CacheService } = await import("../../src/services/cacheService.js");
  const { JwtService: Jwt } = await import("../../src/services/jwtService.js");
  const jwtSvc = new Jwt(JWT_SECRET);

  server.decorate("poolManager", new PoolManager({} as never));
  server.decorate("cache", new CacheService());
  server.decorateRequest("user", null);
  server.decorateRequest("dbName", null);

  server.decorate("authenticate", async (req: never, reply: never) => {
    const auth = (req as { headers: Record<string, string> }).headers.authorization;
    if (!auth?.startsWith("Bearer ")) {
      return (reply as { status: (n: number) => { send: (b: unknown) => void } })
        .status(401).send({ error: "Unauthorized" });
    }
    const payload = await jwtSvc.verify(auth.slice(7));
    if (!payload) {
      return (reply as { status: (n: number) => { send: (b: unknown) => void } })
        .status(401).send({ error: "Invalid" });
    }
    (req as { user: unknown }).user = payload;
  });
  server.decorate("authenticateAdmin", async () => {});
  server.decorate("authenticateAny", async (req: never, reply: never) => {
    return (server as never as { authenticate: (r: never, rep: never) => Promise<void> }).authenticate(req, reply);
  });

  const { dbRoutes } = await import("../../src/routes/db/index.js");
  await server.register(dbRoutes, { prefix: "/db" });
  await server.ready();

  const jwtSvcDirect = new JwtService(JWT_SECRET);
  adminToken = await jwtSvcDirect.signAdminToken();
  schemaToken = await jwtSvcDirect.signDbToken("project1", ["read", "schema"]);
  readToken = await jwtSvcDirect.signDbToken("project1", ["read"]);
});

afterAll(async () => {
  await server.close();
  vi.unstubAllEnvs();
});

// ─── POST /db/:database/tables/:table/columns ────────────────────────────────

describe("POST /db/:database/tables/:table/columns — add column", () => {
  it("adds a column with schema scope → 201", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/db/project1/tables/users/columns",
      headers: { Authorization: `Bearer ${schemaToken}` },
      payload: { name: "bio", type: "TEXT" },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.column).toBe("bio");
    expect(body.added).toBe(true);
  });

  it("adds a column with admin token → 201", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/db/project1/tables/users/columns",
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: { name: "avatar_url", type: "TEXT", nullable: true },
    });
    expect(res.statusCode).toBe(201);
  });

  it("returns 403 with read scope", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/db/project1/tables/users/columns",
      headers: { Authorization: `Bearer ${readToken}` },
      payload: { name: "bio", type: "TEXT" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("invalid column name → 400", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/db/project1/tables/users/columns",
      headers: { Authorization: `Bearer ${schemaToken}` },
      payload: { name: "123bad!", type: "TEXT" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("invalid table name (SQL keyword) → 400", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/db/project1/tables/select/columns",
      headers: { Authorization: `Bearer ${schemaToken}` },
      payload: { name: "bio", type: "TEXT" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("invalid type injection → 400", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/db/project1/tables/users/columns",
      headers: { Authorization: `Bearer ${schemaToken}` },
      payload: { name: "x", type: "TEXT; DROP TABLE users" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("parenthesized type (NUMERIC(10,2)) passes → 201", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/db/project1/tables/products/columns",
      headers: { Authorization: `Bearer ${schemaToken}` },
      payload: { name: "price", type: "NUMERIC(10,2)", nullable: true, default: "0" },
    });
    expect(res.statusCode).toBe(201);
  });

  it("nullable:false + default → ALTER TABLE is called with NOT NULL", async () => {
    unsafeMock?.mockClear();
    const res = await server.inject({
      method: "POST",
      url: "/db/project1/tables/users/columns",
      headers: { Authorization: `Bearer ${schemaToken}` },
      payload: { name: "score", type: "INTEGER", nullable: false, default: "0" },
    });
    expect(res.statusCode).toBe(201);
    // ALTER TABLE ... ADD COLUMN ... NOT NULL call must have been made
    const call = unsafeMock?.mock.calls.find((c) =>
      (c[0] as string).includes("NOT NULL")
    );
    expect(call).toBeDefined();
    expect(call![0]).toContain("ALTER TABLE");
    expect(call![0]).toContain('"score"');
    expect(call![0]).toContain("NOT NULL");
  });

  it("nullable:false + no default → 400 (would break existing rows)", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/db/project1/tables/users/columns",
      headers: { Authorization: `Bearer ${schemaToken}` },
      payload: { name: "score", type: "INTEGER", nullable: false },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/NOT NULL/);
  });

  it("now() default passes → 201", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/db/project1/tables/users/columns",
      headers: { Authorization: `Bearer ${schemaToken}` },
      payload: { name: "created_at", type: "TIMESTAMPTZ", default: "now()" },
    });
    expect(res.statusCode).toBe(201);
  });

  it("default injection 'now()); DROP TABLE' → 400", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/db/project1/tables/users/columns",
      headers: { Authorization: `Bearer ${schemaToken}` },
      payload: { name: "ts", type: "TIMESTAMPTZ", default: "now()); DROP TABLE users" },
    });
    expect(res.statusCode).toBe(400);
  });
});

// ─── DELETE /db/:database/tables/:table/columns/:col ─────────────────────────

describe("DELETE /db/:database/tables/:table/columns/:col — delete column", () => {
  it("schema scope ile kolon siler → 200", async () => {
    const res = await server.inject({
      method: "DELETE",
      url: "/db/project1/tables/users/columns/bio",
      headers: { Authorization: `Bearer ${schemaToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.column).toBe("bio");
    expect(body.dropped).toBe(true);
  });

  it("admin token ile kolon siler → 200", async () => {
    const res = await server.inject({
      method: "DELETE",
      url: "/db/project1/tables/users/columns/old_field",
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(200);
  });

  it("returns 403 with read scope", async () => {
    const res = await server.inject({
      method: "DELETE",
      url: "/db/project1/tables/users/columns/bio",
      headers: { Authorization: `Bearer ${readToken}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it("invalid column name (SQL keyword) → 400", async () => {
    const res = await server.inject({
      method: "DELETE",
      url: "/db/project1/tables/users/columns/drop",
      headers: { Authorization: `Bearer ${schemaToken}` },
    });
    expect(res.statusCode).toBe(400);
  });

  it("invalid table name → 400", async () => {
    const res = await server.inject({
      method: "DELETE",
      url: "/db/project1/tables/insert/columns/bio",
      headers: { Authorization: `Bearer ${schemaToken}` },
    });
    expect(res.statusCode).toBe(400);
  });

  it("DROP COLUMN IF EXISTS SQL is generated correctly", async () => {
    unsafeMock?.mockClear();
    await server.inject({
      method: "DELETE",
      url: "/db/project1/tables/orders/columns/notes",
      headers: { Authorization: `Bearer ${schemaToken}` },
    });
    const call = unsafeMock?.mock.calls.find((c) =>
      (c[0] as string).includes("DROP COLUMN")
    );
    expect(call).toBeDefined();
    expect(call![0]).toContain("DROP COLUMN IF EXISTS");
    expect(call![0]).toContain('"notes"');
    expect(call![0]).toContain('"orders"');
  });
});

// ─── PATCH /db/:database/tables/:table/columns/:col ──────────────────────────

describe("PATCH /db/:database/tables/:table/columns/:col — update column", () => {
  it("nullable:false → generates SET NOT NULL SQL → 200", async () => {
    unsafeMock?.mockClear();
    const res = await server.inject({
      method: "PATCH",
      url: "/db/project1/tables/users/columns/email",
      headers: { Authorization: `Bearer ${schemaToken}` },
      payload: { nullable: false },
    });
    expect(res.statusCode).toBe(200);
    const call = unsafeMock?.mock.calls.find((c) =>
      (c[0] as string).includes("SET NOT NULL")
    );
    expect(call).toBeDefined();
    expect(call![0]).toContain("ALTER COLUMN");
    expect(call![0]).toContain('"email"');
  });

  it("nullable:true → generates DROP NOT NULL SQL → 200", async () => {
    unsafeMock?.mockClear();
    const res = await server.inject({
      method: "PATCH",
      url: "/db/project1/tables/users/columns/phone",
      headers: { Authorization: `Bearer ${schemaToken}` },
      payload: { nullable: true },
    });
    expect(res.statusCode).toBe(200);
    const call = unsafeMock?.mock.calls.find((c) =>
      (c[0] as string).includes("DROP NOT NULL")
    );
    expect(call).toBeDefined();
  });

  it("default value → generates SET DEFAULT SQL → 200", async () => {
    unsafeMock?.mockClear();
    const res = await server.inject({
      method: "PATCH",
      url: "/db/project1/tables/products/columns/stock",
      headers: { Authorization: `Bearer ${schemaToken}` },
      payload: { default: "0" },
    });
    expect(res.statusCode).toBe(200);
    const call = unsafeMock?.mock.calls.find((c) =>
      (c[0] as string).includes("SET DEFAULT")
    );
    expect(call).toBeDefined();
    expect(call![0]).toContain('"stock"');
  });

  it("dropDefault:true → generates DROP DEFAULT SQL → 200", async () => {
    unsafeMock?.mockClear();
    const res = await server.inject({
      method: "PATCH",
      url: "/db/project1/tables/products/columns/stock",
      headers: { Authorization: `Bearer ${schemaToken}` },
      payload: { dropDefault: true },
    });
    expect(res.statusCode).toBe(200);
    const call = unsafeMock?.mock.calls.find((c) =>
      (c[0] as string).includes("DROP DEFAULT")
    );
    expect(call).toBeDefined();
  });

  it("dropDefault:true, default field is ignored", async () => {
    unsafeMock?.mockClear();
    const res = await server.inject({
      method: "PATCH",
      url: "/db/project1/tables/products/columns/stock",
      headers: { Authorization: `Bearer ${schemaToken}` },
      payload: { dropDefault: true, default: "99" },
    });
    expect(res.statusCode).toBe(200);
    // SET DEFAULT call must not happen — dropDefault takes priority
    const setDefaultCall = unsafeMock?.mock.calls.find((c) =>
      (c[0] as string).includes("SET DEFAULT")
    );
    expect(setDefaultCall).toBeUndefined();
  });

  it("nullable + default at the same time → two separate ALTER calls → 200", async () => {
    unsafeMock?.mockClear();
    const res = await server.inject({
      method: "PATCH",
      url: "/db/project1/tables/users/columns/score",
      headers: { Authorization: `Bearer ${schemaToken}` },
      payload: { nullable: false, default: "0" },
    });
    expect(res.statusCode).toBe(200);
    const notNullCall = unsafeMock?.mock.calls.find((c) =>
      (c[0] as string).includes("SET NOT NULL")
    );
    const defaultCall = unsafeMock?.mock.calls.find((c) =>
      (c[0] as string).includes("SET DEFAULT")
    );
    expect(notNullCall).toBeDefined();
    expect(defaultCall).toBeDefined();
  });

  it("returns 400 when no fields are provided", async () => {
    const res = await server.inject({
      method: "PATCH",
      url: "/db/project1/tables/users/columns/email",
      headers: { Authorization: `Bearer ${schemaToken}` },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/No valid fields/);
  });

  it("returns 403 with read scope", async () => {
    const res = await server.inject({
      method: "PATCH",
      url: "/db/project1/tables/users/columns/email",
      headers: { Authorization: `Bearer ${readToken}` },
      payload: { nullable: true },
    });
    expect(res.statusCode).toBe(403);
  });

  it("invalid column name → 400", async () => {
    const res = await server.inject({
      method: "PATCH",
      url: "/db/project1/tables/users/columns/select",
      headers: { Authorization: `Bearer ${schemaToken}` },
      payload: { nullable: true },
    });
    expect(res.statusCode).toBe(400);
  });

  it("default injection → 400", async () => {
    const res = await server.inject({
      method: "PATCH",
      url: "/db/project1/tables/users/columns/ts",
      headers: { Authorization: `Bearer ${schemaToken}` },
      payload: { default: "now()); DROP TABLE users" },
    });
    expect(res.statusCode).toBe(400);
  });
});