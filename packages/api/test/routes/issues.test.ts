/**
 * database-issues.md — Tespit edilen sorunların regresyon testleri.
 *
 * Her test, raporlanan bir sorunu doğrular ve fix'in çalıştığını kanıtlar.
 *
 * #2 — DB-user token CRUD endpoint erişimi
 * #4 — 403 hata mesajında gerekli scope belirtilmeli
 * #5 — POST /query response shape tutarsızlığı (count vs total)
 * #6 — Geçersiz where operatörü sessizce yok sayılıyordu → şimdi 400
 * #7 — POST /query bigint count(*) string olarak geliyordu → şimdi number
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

// Mock rows dönecek sorgu sonuçları
const MOCK_ROWS = [
  { id: 1, name: "Alice" },
  { id: 2, name: "Bob" },
];

vi.mock("postgres", () => {
  const sqlFn = vi.fn(() => {
    const fn = vi.fn().mockResolvedValue(MOCK_ROWS) as unknown as Record<string, unknown>;
    fn.unsafe = vi.fn().mockResolvedValue(MOCK_ROWS);
    fn.end = vi.fn().mockResolvedValue(undefined);
    // begin("read only", cb) — rows GET ve query handler'ları için
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
    get: vi.fn().mockResolvedValue(null), // cache miss — her zaman DB'ye git
    set: vi.fn().mockResolvedValue(undefined),
    del: vi.fn().mockResolvedValue(undefined),
    invalidatePattern: vi.fn().mockResolvedValue(undefined),
    buildKey: (...p: string[]) => `postgrify:${p.join(":")}`,
  })),
  TTL: { ROW_QUERY: 30, SCHEMA: 300, TABLE_LIST: 120, DB_SIZE: 60 },
}));

// Mock audit log (query route içinden provision.ts import ediliyor)
vi.mock("../../src/routes/db/auth/provision.js", () => ({
  insertAuditLog: vi.fn().mockResolvedValue(undefined),
  ensureAuthSchema: vi.fn().mockResolvedValue(undefined),
  provisionApiKey: vi.fn().mockResolvedValue("test-api-key"),
  getApiKey: vi.fn().mockResolvedValue("test-api-key"),
  getAuthSetting: vi.fn().mockResolvedValue(null),
}));

let server: FastifyInstance;
let jwtSvc: JwtService;

// Token'lar
let adminToken: string;
let dbReadWriteToken: string;   // project1 için read+write scope'lu DB token
let dbReadToken: string;        // project1 için yalnızca read scope'lu DB token
let dbUserEditorToken: string;  // project1 için editor rolündeki DB-user token
let dbUserViewerToken: string;  // project1 için viewer rolündeki DB-user token
let dbUserWrongDbToken: string; // farklı DB için DB-user token

beforeAll(async () => {
  server = Fastify({ logger: false });

  const { PoolManager } = await import("../../src/services/poolManager.js");
  const { CacheService } = await import("../../src/services/cacheService.js");

  server.decorate("poolManager", new PoolManager({} as never));
  server.decorate("cache", new CacheService());

  // authenticate: DB token veya admin token
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

  // authenticateAny: DB token, admin token veya DB-user token
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

  // Token üretimi
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
// Issue #6 — Geçersiz where operatörü 400 döndürmeli (güvenlik kritik)
// ─────────────────────────────────────────────────────────────────────────────
describe("Issue #6 — geçersiz where operatörü", () => {
  it("bilinmeyen operatör 400 döndürür (tablo dönmemeli)", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/db/project1/users?where=id.badop.1",
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    // Hata mesajı operatör bilgisi içermeli
    expect(body.error).toMatch(/Invalid query parameter/i);
    expect(body.message).toMatch(/badop/);
  });

  it("başka bilinmeyen operatör de 400 döndürür", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/db/project1/users?where=name.contains.alice",
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/contains/);
  });

  it("geçerli operatör 200 döndürür", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/db/project1/users?where=id.eq.1",
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(200);
  });

  it("geçersiz sütun adı da 400 döndürür", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/db/project1/users?where=select.eq.1",
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(400);
  });

  it("where format hatası (nokta yok) 400 döndürür", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/db/project1/users?where=broken",
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Issue #4 — 403 mesajı hangi scope'un gerektiğini belirtmeli
// ─────────────────────────────────────────────────────────────────────────────
describe("Issue #4 — 403 hata mesajında scope bilgisi", () => {
  it("write scope'lu token schema gerektiren endpoint'e erişince mesajda 'schema' geçer", async () => {
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
    // Hata mesajı "schema" kelimesini içermeli — geliştiriciye hangi scope gerektiği söylenmeli
    expect(body.message).toMatch(/schema/i);
  });

  it("read token ile write gerektiren endpoint'e erişince mesajda 'write' geçer", async () => {
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
// Issue #5 — POST /query response shape tutarlılığı
// ─────────────────────────────────────────────────────────────────────────────
describe("Issue #5 — POST /query response shape", () => {
  let queryToken: string;

  beforeAll(async () => {
    queryToken = await jwtSvc.signDbToken("project1", ["read", "query"]);
  });

  it("response { rows, total, limit, offset } shape'ine sahip olmalı", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/db/project1/query",
      headers: { Authorization: `Bearer ${queryToken}` },
      payload: { sql: "SELECT * FROM users" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    // Yeni tutarlı shape
    expect(body).toHaveProperty("rows");
    expect(body).toHaveProperty("total");
    expect(body).toHaveProperty("limit");
    expect(body).toHaveProperty("offset");

    // Eski tutarsız field artık olmamalı
    expect(body).not.toHaveProperty("count");
  });

  it("total, rows dizisinin uzunluğuna eşit olmalı", async () => {
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
// Issue #7 — POST /query bigint sayılar number olarak gelmeli
// ─────────────────────────────────────────────────────────────────────────────
describe("Issue #7 — POST /query bigint coercion", () => {
  let queryToken: string;

  beforeAll(async () => {
    queryToken = await jwtSvc.signDbToken("project1", ["read", "query"]);
  });

  it("count(*) gibi bigint değerler string değil number olarak gelmeli", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/db/project1/query",
      headers: { Authorization: `Bearer ${queryToken}` },
      payload: { sql: "SELECT count(*) FROM users" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    // rows içindeki sayısal değerler number tipinde olmalı, string değil
    if (body.rows.length > 0) {
      for (const row of body.rows) {
        for (const [key, val] of Object.entries(row)) {
          if (typeof val === "string" && /^\d+$/.test(val as string)) {
            // String olarak gelen saf sayı — bug hâlâ var
            throw new Error(`Field '${key}' is a numeric string "${val}" — should be number`);
          }
        }
      }
    }
    // total da number olmalı
    expect(typeof body.total).toBe("number");
  });

  it("total strict equality ile karşılaştırılabilmeli (=== 2, string değil)", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/db/project1/query",
      headers: { Authorization: `Bearer ${queryToken}` },
      payload: { sql: "SELECT * FROM users" },
    });
    const body = res.json();
    // Bu satır "3" === 3 sorununu simüle eder — tip kontrolü olan kod için kritik
    expect(body.total).toBe(2); // mock 2 row döndürüyor
    expect(typeof body.total).toBe("number");
    expect(body.total === 2).toBe(true); // strict equality
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Issue #2 — DB-user token CRUD endpoint erişimi
// (authenticateAny kullanılan route'lar için)
// ─────────────────────────────────────────────────────────────────────────────
describe("Issue #2 — DB-user token CRUD erişimi (scopeGuard DB-user farkındalığı)", () => {
  it("editor rolündeki DB-user token read erişimine izin verir", async () => {
    // scopeGuard, DB-user token'ı editor → read,write,delete scope'larıyla eşler
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
    expect(replied).toBe(false); // guard geçti
  });

  it("editor rolündeki DB-user token write erişimine izin verir", async () => {
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

  it("viewer rolündeki DB-user token write erişimine izin vermez — 403", async () => {
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

  it("viewer rolündeki DB-user token read erişimine izin verir", async () => {
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

  it("DB-user token farklı DB'ye erişemez — 403", async () => {
    const { scopeGuard } = await import("../../src/middleware/scopeGuard.js");
    const guard = scopeGuard("read");

    const req = {
      user: null,
      dbUser: { db: "otherdb", role: "editor", sub: "user-id", iss: "postgrify/db-auth", email: "e@t.com" },
      dbName: "project1", // farklı DB
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

  it("editor DB-user token schema scope'una erişemez", async () => {
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

  it("DB-user admin rolü schema scope'a erişebilir", async () => {
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

  it("403 mesajı roller ve gerekli scope bilgisini içermeli", async () => {
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
// Postgrify Issue P1 — DB-user token ile CRUD route'larına erişim
// (routes/db/index.ts'te authenticateAny kullanılması)
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
    // scopeGuard editor → write scope → geçer; mock DB insert'i başarılı
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

  it("yanlış DB için DB-user token → 403 (cross-database erişim engeli)", async () => {
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
    // SORUN #11 fix: editor artık "query" scope'una sahip olduğu için 200 bekliyoruz.
    // Önceki beklenti: 403 (editor query scope'u yoktu). Şimdi fix uygulandı.
    expect(res.statusCode).toBe(200);
  });

  it("admin DB-user token ile POST /db/:db/query → 200 (query scope var)", async () => {
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
// Postgrify Issue P2 — X-API-Key header CRUD endpoint'lerinde geçersiz
// ─────────────────────────────────────────────────────────────────────────────
describe("Issue P2 — X-API-Key CRUD endpoint'lerinde yok sayılır (reject edilmez)", () => {
  it("CRUD endpoint'ine X-API-Key + geçerli Bearer → 200 (header yok sayılır)", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/db/project1/users",
      headers: {
        Authorization: `Bearer ${adminToken}`,
        "X-API-Key": "some-api-key-that-should-be-ignored",
      },
    });
    // X-API-Key CRUD route'larında reject edilmemeli — header sessizce yok sayılır
    expect(res.statusCode).toBe(200);
  });

  it("Bearer token olmadan sadece X-API-Key ile CRUD → 401 (token gerekli)", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/db/project1/users",
      headers: {
        "X-API-Key": "some-api-key",
      },
    });
    // X-API-Key CRUD'da kabul edilmiyor; authenticate/authenticateAny 401 döner
    expect(res.statusCode).toBe(401);
  });
});