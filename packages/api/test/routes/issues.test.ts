/**
 * database-issues.md — Regression tests for detected issues.
 *
 * Each test verifies a reported issue and proves that the fix works.
 *
 * #2 — DB-user token CRUD endpoint access
 * #4 — required scope must be specified in the 403 error message
 * #5 — POST /query response shape inconsistency (count vs total)
 * #6 — Invalid where operator was silently ignored → now returns 400
 * #7 — POST /query bigint count(*) was returned as a string → now a number
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { JwtService } from "../../src/services/jwtService.js";

const JWT_SECRET = "test-secret-must-be-at-least-32-characters";
const ADMIN_SECRET = "test-admin-secret-16ch";

vi.stubEnv("JWT_SECRET", JWT_SECRET);
vi.stubEnv("ADMIN_SECRET", ADMIN_SECRET);
vi.stubEnv("ALLOW_RAW_SQL_ADMIN", "false");

// Query results that mock rows will return
const MOCK_ROWS = [
  { id: 1, name: "Alice" },
  { id: 2, name: "Bob" },
];

vi.mock("postgres", () => {
  const sqlFn = vi.fn(() => {
    const fn = vi.fn().mockResolvedValue(MOCK_ROWS) as unknown as Record<string, unknown>;
    fn.unsafe = vi.fn().mockResolvedValue(MOCK_ROWS);
    fn.end = vi.fn().mockResolvedValue(undefined);
    // begin("read only", cb) — for rows GET and query handlers
    fn.begin = vi.fn().mockImplementation((_mode: string, cb: (sql: unknown) => unknown) => {
      const txFn = vi.fn().mockResolvedValue(MOCK_ROWS) as unknown as Record<string, unknown>;
      txFn.unsafe = vi.fn()
        .mockResolvedValueOnce(MOCK_ROWS)          // rows
        .mockResolvedValueOnce([{ total: "2" }]);  // count (bigint → string)
      return cb(txFn);
    });
    return fn;
  });
  return { default: sqlFn };
});

vi.mock("../../src/services/cacheService.js", () => ({
  CacheService: vi.fn().mockImplementation(() => ({
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    get: vi.fn().mockResolvedValue(null), // cache miss — always go to DB
    set: vi.fn().mockResolvedValue(undefined),
    del: vi.fn().mockResolvedValue(undefined),
    invalidatePattern: vi.fn().mockResolvedValue(undefined),
    buildKey: (...p: string[]) => `postgrify:${p.join(":")}`,
  })),
  TTL: { ROW_QUERY: 30, SCHEMA: 300, TABLE_LIST: 120, DB_SIZE: 60 },
}));

// Mock audit log (provision.ts is imported from inside the query route)
vi.mock("../../src/routes/db/auth/provision.js", () => ({
  insertAuditLog: vi.fn().mockResolvedValue(undefined),
  ensureAuthSchema: vi.fn().mockResolvedValue(undefined),
  provisionApiKey: vi.fn().mockResolvedValue("test-api-key"),
  getApiKey: vi.fn().mockResolvedValue("test-api-key"),
  getAuthSetting: vi.fn().mockResolvedValue(null),
}));

let server: FastifyInstance;
let jwtSvc: JwtService;

// Tokens
let adminToken: string;
let dbReadWriteToken: string;   // DB token with read+write scope for project1
let dbReadToken: string;        // DB token with read-only scope for project1
let dbUserEditorToken: string;  // DB-user token with editor role for project1
let dbUserViewerToken: string;  // DB-user token with viewer role for project1
let dbUserWrongDbToken: string; // DB-user token for a different DB

beforeAll(async () => {
  server = Fastify({ logger: false });

  const { PoolManager } = await import("../../src/services/poolManager.js");
  const { CacheService } = await import("../../src/services/cacheService.js");

  server.decorate("poolManager", new PoolManager({} as never));
  server.decorate("cache", new CacheService());

  // authenticate: DB token or admin token
  const { JwtService: Jwt } = await import("../../src/services/jwtService.js");
  jwtSvc = new Jwt(JWT_SECRET);

  server.decorate("authenticate", async (req: never, reply: never) => {
    const auth = (req as { headers: Record<string, string> }).headers.authorization;
    if (!auth?.startsWith("Bearer ")) {
      return (reply as { status: (n: number) => { send: (b: unknown) => void } })
        .status(401).send({ error: "Unauthorized" });
    }
    const payload = await jwtSvc.verifyAdminOrDb(auth.slice(7));
    if (!payload) return (reply as { status: (n: number) => { send: (b: unknown) => void } })
      .status(401).send({ error: "Invalid token" });
    (req as { user: unknown }).user = payload;
  });

  // authenticateAny: DB token, admin token, or DB-user token
  server.decorate("authenticateAny", async (req: never, reply: never) => {
    const auth = (req as { headers: Record<string, string> }).headers.authorization;
    if (!auth?.startsWith("Bearer ")) {
      return (reply as { status: (n: number) => { send: (b: unknown) => void } })
        .status(401).send({ error: "Unauthorized" });
    }
    const token = auth.slice(7);

    const adminOrDb = await jwtSvc.verifyAdminOrDb(token);
    if (adminOrDb) {
      (req as { user: unknown }).user = adminOrDb;
      return;
    }

    const dbUser = await jwtSvc.verifyDbUser(token);
    if (dbUser) {
      (req as { dbUser: unknown }).dbUser = dbUser;
      return;
    }

    return (reply as { status: (n: number) => { send: (b: unknown) => void } })
      .status(401).send({ error: "Invalid token" });
  });

  server.decorate("authenticateAdmin", async () => {});
  server.decorateRequest("user", null);
  server.decorateRequest("dbName", null);
  server.decorateRequest("dbUser", null);

  const { dbRoutes } = await import("../../src/routes/db/index.js");
  await server.register(dbRoutes, { prefix: "/db" });
  await server.ready();

  // Token generation
  adminToken = await jwtSvc.signAdminToken();
  dbReadWriteToken = await jwtSvc.signDbToken("project1", ["read", "write", "delete"]);
  dbReadToken = await jwtSvc.signDbToken("project1", ["read"]);
  dbUserEditorToken = await jwtSvc.signDbUserToken("project1", "user-editor-id", "editor@test.com", "editor");
  dbUserViewerToken = await jwtSvc.signDbUserToken("project1", "user-viewer-id", "viewer@test.com", "viewer");
  dbUserWrongDbToken = await jwtSvc.signDbUserToken("otherdb", "user-other-id", "other@test.com", "editor");
});

afterAll(async () => {
  await server.close();
  vi.unstubAllEnvs();
});

// ─────────────────────────────────────────────────────────────────────────────
// Issue #6 — Invalid where operator should return 400 (security critical)
// ─────────────────────────────────────────────────────────────────────────────
describe("Issue #6 — invalid where operator", () => {
  it("unknown operator returns 400 (must not return rows)", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/db/project1/users?where=id.badop.1",
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    // Error message must contain operator information
    expect(body.error).toMatch(/Invalid query parameter/i);
    expect(body.message).toMatch(/badop/);
  });

  it("another unknown operator also returns 400", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/db/project1/users?where=name.contains.alice",
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/contains/);
  });

  it("valid operator returns 200", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/db/project1/users?where=id.eq.1",
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(200);
  });

  it("invalid column name also returns 400", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/db/project1/users?where=select.eq.1",
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(400);
  });

  it("where format error (no dot) returns 400", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/db/project1/users?where=broken",
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Issue #4 — 403 message must specify which scope is required
// ─────────────────────────────────────────────────────────────────────────────
describe("Issue #4 — scope information in 403 error message", () => {
  it("when a write-scoped token accesses a schema-required endpoint, the message contains 'schema'", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/db/project1/tables",
      headers: { Authorization: `Bearer ${dbReadWriteToken}` },
      payload: {
        name: "test_table",
        columns: [{ name: "id", type: "SERIAL" }],
      },
    });
    expect(res.statusCode).toBe(403);
    const body = res.json();
    // Error message must contain "schema" — must tell the developer which scope is required
    expect(body.message).toMatch(/schema/i);
  });

  it("when a read token accesses a write-required endpoint, the message contains 'write'", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/db/project1/users",
      headers: { Authorization: `Bearer ${dbReadToken}` },
      payload: { name: "Charlie" },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().message).toMatch(/write/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Issue #5 — POST /query response shape consistency
// ─────────────────────────────────────────────────────────────────────────────
describe("Issue #5 — POST /query response shape", () => {
  let queryToken: string;

  beforeAll(async () => {
    queryToken = await jwtSvc.signDbToken("project1", ["read", "query"]);
  });

  it("response must have the { rows, total, limit, offset } shape", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/db/project1/query",
      headers: { Authorization: `Bearer ${queryToken}` },
      payload: { sql: "SELECT * FROM users" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    // New consistent shape
    expect(body).toHaveProperty("rows");
    expect(body).toHaveProperty("total");
    expect(body).toHaveProperty("limit");
    expect(body).toHaveProperty("offset");

    // Old inconsistent field must no longer exist
    expect(body).not.toHaveProperty("count");
  });

  it("total must equal the length of the rows array", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/db/project1/query",
      headers: { Authorization: `Bearer ${queryToken}` },
      payload: { sql: "SELECT * FROM users" },
    });
    const body = res.json();
    expect(body.total).toBe(body.rows.length);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Issue #7 — POST /query bigint numbers should be returned as number
// ─────────────────────────────────────────────────────────────────────────────
describe("Issue #7 — POST /query bigint coercion", () => {
  let queryToken: string;

  beforeAll(async () => {
    queryToken = await jwtSvc.signDbToken("project1", ["read", "query"]);
  });

  it("bigint values like count(*) should be returned as number, not string", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/db/project1/query",
      headers: { Authorization: `Bearer ${queryToken}` },
      payload: { sql: "SELECT count(*) FROM users" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    // Numeric values inside rows must be of type number, not string
    if (body.rows.length > 0) {
      for (const row of body.rows) {
        for (const [key, val] of Object.entries(row)) {
          if (typeof val === "string" && /^\d+$/.test(val as string)) {
            // Pure number returned as string — bug still present
            throw new Error(`Field '${key}' is a numeric string "${val}" — should be number`);
          }
        }
      }
    }
    // total must also be a number
    expect(typeof body.total).toBe("number");
  });

  it("total must be comparable with strict equality (=== 2, not string)", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/db/project1/query",
      headers: { Authorization: `Bearer ${queryToken}` },
      payload: { sql: "SELECT * FROM users" },
    });
    const body = res.json();
    // This line simulates the "3" === 3 problem — critical for code with type checks
    expect(body.total).toBe(2); // mock returns 2 rows
    expect(typeof body.total).toBe("number");
    expect(body.total === 2).toBe(true); // strict equality
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Issue #2 — DB-user token CRUD endpoint access
// (for routes that use authenticateAny)
// ─────────────────────────────────────────────────────────────────────────────
describe("Issue #2 — DB-user token CRUD access (scopeGuard DB-user awareness)", () => {
  it("DB-user token with editor role allows read access", async () => {
    // scopeGuard maps DB-user token editor → read,write,delete scopes
    const { scopeGuard } = await import("../../src/middleware/scopeGuard.js");
    const guard = scopeGuard("read");

    const req = {
      user: null,
      dbUser: { db: "project1", role: "editor", sub: "user-id", iss: "postgrify/db-auth", email: "e@t.com" },
      dbName: "project1",
    };
    let replied = false;
    const reply = {
      status: () => ({ send: () => { replied = true; } }),
    };

    await guard(req as never, reply as never);
    expect(replied).toBe(false); // guard passed
  });

  it("DB-user token with editor role allows write access", async () => {
    const { scopeGuard } = await import("../../src/middleware/scopeGuard.js");
    const guard = scopeGuard("write");

    const req = {
      user: null,
      dbUser: { db: "project1", role: "editor", sub: "user-id", iss: "postgrify/db-auth", email: "e@t.com" },
      dbName: "project1",
    };
    let replied = false;
    const reply = { status: () => ({ send: () => { replied = true; } }) };

    await guard(req as never, reply as never);
    expect(replied).toBe(false);
  });

  it("DB-user token with viewer role does not allow write access — 403", async () => {
    const { scopeGuard } = await import("../../src/middleware/scopeGuard.js");
    const guard = scopeGuard("write");

    const req = {
      user: null,
      dbUser: { db: "project1", role: "viewer", sub: "user-id", iss: "postgrify/db-auth", email: "v@t.com" },
      dbName: "project1",
    };

    let statusCode = 0;
    const reply = {
      status: (code: number) => {
        statusCode = code;
        return { send: () => {} };
      },
    };

    await guard(req as never, reply as never);
    expect(statusCode).toBe(403);
  });

  it("DB-user token with viewer role allows read access", async () => {
    const { scopeGuard } = await import("../../src/middleware/scopeGuard.js");
    const guard = scopeGuard("read");

    const req = {
      user: null,
      dbUser: { db: "project1", role: "viewer", sub: "user-id", iss: "postgrify/db-auth", email: "v@t.com" },
      dbName: "project1",
    };
    let replied = false;
    const reply = { status: () => ({ send: () => { replied = true; } }) };

    await guard(req as never, reply as never);
    expect(replied).toBe(false);
  });

  it("DB-user token cannot access a different DB — 403", async () => {
    const { scopeGuard } = await import("../../src/middleware/scopeGuard.js");
    const guard = scopeGuard("read");

    const req = {
      user: null,
      dbUser: { db: "otherdb", role: "editor", sub: "user-id", iss: "postgrify/db-auth", email: "e@t.com" },
      dbName: "project1", // different DB
    };

    let statusCode = 0;
    const reply = {
      status: (code: number) => {
        statusCode = code;
        return { send: () => {} };
      },
    };

    await guard(req as never, reply as never);
    expect(statusCode).toBe(403);
  });

  it("editor DB-user token cannot access schema scope", async () => {
    const { scopeGuard } = await import("../../src/middleware/scopeGuard.js");
    const guard = scopeGuard("schema");

    const req = {
      user: null,
      dbUser: { db: "project1", role: "editor", sub: "user-id", iss: "postgrify/db-auth", email: "e@t.com" },
      dbName: "project1",
    };

    let statusCode = 0;
    const reply = {
      status: (code: number) => {
        statusCode = code;
        return { send: () => {} };
      },
    };

    await guard(req as never, reply as never);
    expect(statusCode).toBe(403);
  });

  it("DB-user with admin role can access schema scope", async () => {
    const { scopeGuard } = await import("../../src/middleware/scopeGuard.js");
    const guard = scopeGuard("schema");

    const req = {
      user: null,
      dbUser: { db: "project1", role: "admin", sub: "user-id", iss: "postgrify/db-auth", email: "a@t.com" },
      dbName: "project1",
    };
    let replied = false;
    const reply = { status: () => ({ send: () => { replied = true; } }) };

    await guard(req as never, reply as never);
    expect(replied).toBe(false);
  });

  it("403 message must contain role and required scope information", async () => {
    const { scopeGuard } = await import("../../src/middleware/scopeGuard.js");
    const guard = scopeGuard("write");

    const req = {
      user: null,
      dbUser: { db: "project1", role: "viewer", sub: "user-id", iss: "postgrify/db-auth", email: "v@t.com" },
      dbName: "project1",
    };

    let sentBody: unknown = null;
    const reply = {
      status: (_code: number) => ({
        send: (body: unknown) => { sentBody = body; },
      }),
    };

    await guard(req as never, reply as never);
    const body = sentBody as { message?: string };
    expect(body?.message).toMatch(/write/i);
    expect(body?.message).toMatch(/viewer/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Postgrify Issue P1 — DB-user token access to CRUD routes
// (using authenticateAny in routes/db/index.ts)
// ─────────────────────────────────────────────────────────────────────────────
describe("Issue P1 — DB-user token CRUD route entegrasyon testi", () => {
  it("editor DB-user token ile GET /db/:db/:table → 200", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/db/project1/users",
      headers: { Authorization: `Bearer ${dbUserEditorToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    // C-01: body is a flat array, not { rows, total }
    expect(Array.isArray(body)).toBe(true);
  });

  it("editor DB-user token ile POST /db/:db/:table → 201", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/db/project1/users",
      headers: { Authorization: `Bearer ${dbUserEditorToken}` },
      payload: { name: "Test User" },
    });
    // scopeGuard editor → write scope → passes; mock DB insert succeeds
    // C-02: Prefer:return=minimal (default) → 204 no body; representation → array
    // Mock returns empty array, so 201 with empty body or minimal response
    expect([201, 204]).toContain(res.statusCode);
  });

  it("viewer DB-user token ile POST /db/:db/:table → 403 (write scope yok)", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/db/project1/users",
      headers: { Authorization: `Bearer ${dbUserViewerToken}` },
      payload: { name: "Test User" },
    });
    expect(res.statusCode).toBe(403);
    const body = res.json();
    expect(body.message).toMatch(/write/i);
  });

  it("viewer DB-user token ile GET /db/:db/:table → 200 (read scope var)", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/db/project1/users",
      headers: { Authorization: `Bearer ${dbUserViewerToken}` },
    });
    expect(res.statusCode).toBe(200);
  });

  it("DB-user token for wrong DB → 403 (cross-database access blocked)", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/db/project1/users",
      headers: { Authorization: `Bearer ${dbUserWrongDbToken}` },
    });
    expect(res.statusCode).toBe(403);
    const body = res.json();
    expect(body.message).toMatch(/project1/);
  });

  it("admin DB-user token ile DELETE /db/:db/:table/:id → 200 (delete scope var)", async () => {
    const adminDbUserToken = await jwtSvc.signDbUserToken("project1", "admin-id", "admin@test.com", "admin");
    const res = await server.inject({
      method: "DELETE",
      url: "/db/project1/users/1",
      headers: { Authorization: `Bearer ${adminDbUserToken}` },
    });
    expect(res.statusCode).toBe(200);
  });

  it("editor DB-user token ile POST /db/:db/query → 403 (query scope yok)", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/db/project1/query",
      headers: { Authorization: `Bearer ${dbUserEditorToken}` },
      payload: { sql: "SELECT 1" },
    });
    // Issue #11 fix: editor now has the "query" scope, so we expect 200.
    // Previous expectation: 403 (editor had no query scope). Fix has been applied.
    expect(res.statusCode).toBe(200);
  });

  it("admin DB-user token with POST /db/:db/query → 200 (has query scope)", async () => {
    const adminDbUserToken = await jwtSvc.signDbUserToken("project1", "admin-id", "admin@test.com", "admin");
    const res = await server.inject({
      method: "POST",
      url: "/db/project1/query",
      headers: { Authorization: `Bearer ${adminDbUserToken}` },
      payload: { sql: "SELECT 1" },
    });
    expect(res.statusCode).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Postgrify Issue P2 — X-API-Key header is invalid on CRUD endpoints
// ─────────────────────────────────────────────────────────────────────────────
describe("Issue P2 — X-API-Key is ignored on CRUD endpoints (not rejected)", () => {
  it("CRUD endpoint with X-API-Key + valid Bearer → 200 (header is ignored)", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/db/project1/users",
      headers: {
        Authorization: `Bearer ${adminToken}`,
        "X-API-Key": "some-api-key-that-should-be-ignored",
      },
    });
    // X-API-Key must not be rejected on CRUD routes — header is silently ignored
    expect(res.statusCode).toBe(200);
  });

  it("CRUD with only X-API-Key and no Bearer token → 401 (token required)", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/db/project1/users",
      headers: {
        "X-API-Key": "some-api-key",
      },
    });
    // X-API-Key is not accepted on CRUD routes; authenticate/authenticateAny returns 401
    expect(res.statusCode).toBe(401);
  });
});