/**
 * Test: SORUN #7 Düzeltmesi — default_user_role auth ayarı.
 *
 * 1. provision.ts'de 'default_user_role' = 'viewer' varsayılan olarak eklendi.
 * 2. settings.ts'de AUTH_SETTING_KEYS listesine eklendi (PUT ile değiştirilebilir).
 * 3. signup.ts'de bu ayar okunup yeni kullanıcıya uygulanıyor.
 *
 * Bu test:
 * - PUT /auth/settings ile default_user_role=editor yapılabildiğini doğrular.
 * - Geçersiz rol değerinin reddedildiğini doğrular.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { JwtService } from "../../src/services/jwtService.js";

const JWT_SECRET = "test-secret-must-be-at-least-32-characters-long";

vi.stubEnv("JWT_SECRET", JWT_SECRET);
vi.stubEnv("ADMIN_SECRET", "test-admin-16ch");

// In-memory settings store
const mockSettings: Record<string, string> = {
  email_signup_enabled: "true",
  default_user_role: "viewer",
};

vi.mock("postgres", () => {
  const sqlMock = vi.fn(() => {
    const fn = vi.fn().mockImplementation(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const query = strings.join("?").toLowerCase();

      // GET settings: SELECT key, value FROM _postgrify_auth.auth_settings
      if (query.includes("select key, value from _postgrify_auth.auth_settings")) {
        return Object.entries(mockSettings).map(([key, value]) => ({ key, value }));
      }
      if (query.includes("from _postgrify_auth.oauth_providers")) {
        return [];
      }
      // INSERT/UPDATE settings (ON CONFLICT)
      if (query.includes("insert into _postgrify_auth.auth_settings")) {
        return [];
      }
      return [];
    }) as unknown as Record<string, unknown>;
    fn.unsafe = vi.fn().mockResolvedValue([]);
    fn.end = vi.fn().mockResolvedValue(undefined);
    fn.begin = vi.fn().mockImplementation((_: string, cb: (tx: unknown) => unknown) => cb(fn));
    return fn;
  });
  return { default: sqlMock };
});

vi.mock("../../src/services/cacheService.js", () => ({
  CacheService: vi.fn().mockImplementation(() => ({
    connect: vi.fn(),
    disconnect: vi.fn(),
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn(),
    del: vi.fn(),
    invalidatePattern: vi.fn(),
    buildKey: (...p: string[]) => p.join(":"),
  })),
  TTL: { ROW_QUERY: 30, SCHEMA: 300, TABLE_LIST: 120, DB_SIZE: 60 },
}));

vi.mock("../../src/routes/db/auth/provision.js", () => ({
  ensureAuthSchema: vi.fn().mockResolvedValue(undefined),
  insertAuditLog: vi.fn().mockResolvedValue(undefined),
  getAuthSetting: vi.fn().mockImplementation(async (_sql: unknown, key: string, defaultVal: string) => {
    return (mockSettings[key] ?? defaultVal).toLowerCase();
  }),
}));

let server: FastifyInstance;
let jwtSvc: JwtService;
let adminToken: string;
let schemaToken: string;

beforeAll(async () => {
  server = Fastify({ logger: false });

  const { PoolManager } = await import("../../src/services/poolManager.js");
  const { CacheService } = await import("../../src/services/cacheService.js");

  server.decorate("poolManager", new PoolManager({} as never));
  server.decorate("cache", new CacheService());
  server.decorateRequest("user", null);
  server.decorateRequest("dbName", "testdb");
  server.decorateRequest("dbUser", null);

  jwtSvc = new JwtService(JWT_SECRET);
  adminToken = await jwtSvc.signAdminToken();
  schemaToken = await jwtSvc.signDbToken("testdb", ["schema", "read", "write"]);

  server.decorate("authenticate", async (req: Parameters<typeof server.authenticate>[0], reply: Parameters<typeof server.authenticate>[1]) => {
    const auth = req.headers.authorization;
    if (!auth?.startsWith("Bearer ")) return reply.status(401).send({ error: "Unauthorized" });
    const payload = await jwtSvc.verifyAdminOrDb(auth.slice(7));
    if (!payload) return reply.status(401).send({ error: "Invalid token" });
    req.user = payload;
  });

  server.decorate("authenticateAdmin", async () => {});
  server.decorate("jwtService", jwtSvc);

  server.decorate("authenticateAny", async (req: Parameters<typeof server.authenticateAny>[0], reply: Parameters<typeof server.authenticateAny>[1]) => {
    const auth = req.headers.authorization;
    if (!auth?.startsWith("Bearer ")) return reply.status(401).send({ error: "Unauthorized" });
    const token = auth.slice(7);
    const adminOrDb = await jwtSvc.verifyAdminOrDb(token);
    if (adminOrDb) { req.user = adminOrDb; return; }
    const dbUser = await jwtSvc.verifyDbUser(token);
    if (dbUser) { req.dbUser = dbUser; return; }
    return reply.status(401).send({ error: "Invalid token" });
  });

  server.addHook("preHandler", async (req) => { req.dbName = "testdb"; });

  const { authSettingsRoute } = await import("../../src/routes/db/auth/settings.js");
  await server.register(authSettingsRoute);
  await server.ready();
});

afterAll(() => server.close());

describe("SORUN #7 — default_user_role ayarı", () => {
  it("GET /auth/settings default_user_role döndürmeli", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/testdb/auth/settings",
      headers: { authorization: `Bearer ${schemaToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    // default_user_role ayarı mevcut olmalı (provision.ts'de eklendi)
    expect(body).toHaveProperty("default_user_role");
    expect(["viewer", "editor", "admin"]).toContain(body.default_user_role);
  });

  it("PUT /auth/settings ile default_user_role=editor yapılabilmeli", async () => {
    const res = await server.inject({
      method: "PUT",
      url: "/testdb/auth/settings",
      headers: { authorization: `Bearer ${schemaToken}`, "content-type": "application/json" },
      payload: { default_user_role: "editor" },
    });

    expect(res.statusCode, `PUT settings hatası: ${res.body}`).toBe(200);
  });

  it("geçersiz default_user_role değeri reddedilmeli", async () => {
    const res = await server.inject({
      method: "PUT",
      url: "/testdb/auth/settings",
      headers: { authorization: `Bearer ${schemaToken}`, "content-type": "application/json" },
      payload: { default_user_role: "superuser" },
    });

    // JSON schema validation enum kontrolü yapacak — 400 bekliyoruz
    expect(res.statusCode).toBe(400);
  });

  it("schema scope olmadan GET settings public GoTrue shape döner (C-20)", async () => {
    const readOnlyToken = await jwtSvc.signDbToken("testdb", ["read"]);
    const res = await server.inject({
      method: "GET",
      url: "/testdb/auth/settings",
      headers: { authorization: `Bearer ${readOnlyToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty("external");
    expect(body).toHaveProperty("disable_signup");
    expect(body).not.toHaveProperty("default_user_role");
  });

  it("auth olmadan GET settings public (C-20)", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/testdb/auth/settings",
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().external.email).toBe(true);
  });
});