/**
 * C-01 security suite — GET /db/:database/:table
 *
 * Threat model (PostgREST hardening + existing KRIT-3 patterns):
 * - SQL injection via table / select / where / order / sort
 * - Authn missing → 401
 * - Scope: read-less token → 403
 * - Cross-DB token cannot read another database
 * - limit capped (DoS via huge limit)
 * - Prefer:count without auth still 401 (no free COUNT)
 * - Malicious Prefer tokens ignored (no crash / no injection)
 *
 * Refs:
 * - https://postgrest.org/en/v10/admin.html (Count-Header DoS)
 * - packages/api/test/security/sql-injection.test.ts
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { JwtService } from "../../src/services/jwtService.js";

const JWT_SECRET = "test-secret-must-be-at-least-32-characters";
const ADMIN_SECRET = "test-admin-secret-16ch";

vi.stubEnv("JWT_SECRET", JWT_SECRET);
vi.stubEnv("ADMIN_SECRET", ADMIN_SECRET);

const MOCK_ROWS = [{ id: 1, name: "ok" }];

/** Capture last SQL passed to tx.unsafe for injection asserts */
const unsafeCalls: string[] = [];

vi.mock("postgres", () => {
  const sqlMock = vi.fn(() => {
    const fn = vi.fn().mockResolvedValue(MOCK_ROWS) as unknown as Record<string, unknown>;
    fn.unsafe = vi.fn().mockResolvedValue(MOCK_ROWS);
    fn.end = vi.fn().mockResolvedValue(undefined);
    fn.begin = vi.fn().mockImplementation((_mode: string, cb: (sql: unknown) => unknown) => {
      const tx = {
        unsafe: vi.fn().mockImplementation((sql: string, params?: unknown[]) => {
          unsafeCalls.push(sql);
          // params must never be interpolated into SQL string by our builder —
          // we only assert identifier safety here; values stay as bind params.
          void params;
          if (/count\(\*\)/i.test(sql)) return Promise.resolve([{ total: "1" }]);
          return Promise.resolve(MOCK_ROWS);
        }),
      };
      return cb(tx);
    });
    return fn;
  });
  return { default: sqlMock };
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
let readToken: string;
let writeOnlyToken: string;
let otherDbToken: string;
let adminToken: string;

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
  server.decorateRequest("dbUser", null);

  server.decorate("authenticate", async (req: never, reply: never) => {
    const auth = (req as { headers: Record<string, string> }).headers.authorization;
    if (!auth?.startsWith("Bearer ")) {
      return (reply as { status: (n: number) => { send: (b: unknown) => void } })
        .status(401)
        .send({ error: "Unauthorized" });
    }
    const payload = await jwtSvc.verifyAdminOrDb(auth.slice(7));
    if (!payload) {
      return (reply as { status: (n: number) => { send: (b: unknown) => void } })
        .status(401)
        .send({ error: "Invalid" });
    }
    (req as { user: unknown }).user = payload;
  });

  server.decorate("authenticateAdmin", async () => {});
  server.decorate("authenticateAny", async (req: never, reply: never) => {
    return (server as never as { authenticate: (r: never, rep: never) => Promise<void> }).authenticate(
      req,
      reply
    );
  });

  const { dbRoutes } = await import("../../src/routes/db/index.js");
  await server.register(dbRoutes, { prefix: "/db" });
  await server.ready();

  const jwt = new JwtService(JWT_SECRET);
  adminToken = await jwt.signAdminToken();
  readToken = await jwt.signDbToken("project1", ["read"]);
  writeOnlyToken = await jwt.signDbToken("project1", ["write"]);
  otherDbToken = await jwt.signDbToken("otherdb", ["read"]);
});

afterAll(async () => {
  await server.close();
  vi.unstubAllEnvs();
});

beforeEach(() => {
  unsafeCalls.length = 0;
});

describe("C-01 security — authentication & authorization", () => {
  it("rejects missing Authorization with 401", async () => {
    const res = await server.inject({ method: "GET", url: "/db/project1/users" });
    expect(res.statusCode).toBe(401);
  });

  it("rejects garbage Bearer token with 401", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/db/project1/users",
      headers: { Authorization: "Bearer not.a.jwt" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("rejects write-only scope for GET (needs read) with 403", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/db/project1/users",
      headers: { Authorization: `Bearer ${writeOnlyToken}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it("rejects cross-database DB token (otherdb token on project1)", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/db/project1/users",
      headers: { Authorization: `Bearer ${otherDbToken}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it("Prefer:count=exact without auth still 401 (no anonymous COUNT)", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/db/project1/users",
      headers: { Prefer: "count=exact" },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe("C-01 security — identifier / SQL injection vectors", () => {
  const evilTables = [
    "users;DROP TABLE users",
    "users--",
    "users/**/x",
    "1 OR 1=1",
    "users UNION SELECT",
    "../../../etc/passwd",
  ];

  it.each(evilTables)("rejects evil table name: %s", async (table) => {
    const res = await server.inject({
      method: "GET",
      url: `/db/project1/${encodeURIComponent(table)}`,
      headers: { Authorization: `Bearer ${readToken}` },
    });
    expect(res.statusCode).toBe(400);
    expect(unsafeCalls.length).toBe(0);
  });

  it("rejects injection in select=", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/db/project1/users?select=id);DROP TABLE users;--",
      headers: { Authorization: `Bearer ${readToken}` },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects injection in where column", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/db/project1/users?where=id;drop.eq.1",
      headers: { Authorization: `Bearer ${readToken}` },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects unknown operator (blocks smuggling)", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/db/project1/users?where=id.eqq.1",
      headers: { Authorization: `Bearer ${readToken}` },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects injection in order column", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/db/project1/users?order=id);drop.asc",
      headers: { Authorization: `Bearer ${readToken}` },
    });
    expect(res.statusCode).toBe(400);
  });

  it("filter VALUES are bound params — SQL string has no raw payload", async () => {
    const payload = "1 OR 1=1";
    const res = await server.inject({
      method: "GET",
      url: `/db/project1/users?where=name.eq.${encodeURIComponent(payload)}`,
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(200);
    // Builder must use $N placeholders; literal OR must not appear as SQL syntax
    const selectSql = unsafeCalls.find((s) => /SELECT/i.test(s) && !/count/i.test(s));
    expect(selectSql).toBeDefined();
    expect(selectSql).toMatch(/\$\d+/);
    expect(selectSql).not.toMatch(/OR 1=1/);
  });
});

describe("C-01 security — DoS / Prefer hardening", () => {
  it("rejects limit > 1000 at schema layer (DoS guard → 400)", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/db/project1/users?limit=99999",
      headers: { Authorization: `Bearer ${readToken}` },
    });
    // Fastify JSON schema maximum:1000 — oversized limit never reaches SQL
    expect(res.statusCode).toBe(400);
    expect(unsafeCalls.length).toBe(0);
  });

  it("accepts limit=1000 (hard ceiling)", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/db/project1/users?limit=1000",
      headers: { Authorization: `Bearer ${readToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
  });

  it("ignores unknown Prefer tokens without 500", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/db/project1/users",
      headers: {
        Authorization: `Bearer ${readToken}`,
        Prefer: "timezone=UTC, count=exact, tx=rollback",
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-range"]).toBe("0-0/1");
  });

  it("invalid Prefer count value falls back to no count (/*)", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/db/project1/users",
      headers: {
        Authorization: `Bearer ${readToken}`,
        Prefer: "count=exact; DROP TABLE users",
      },
    });
    // parsePrefer only accepts exact|planned|estimated after = ; garbage → null count
    expect(res.statusCode).toBe(200);
    expect(String(res.headers["content-range"])).toMatch(/\/\*$/);
  });
});
