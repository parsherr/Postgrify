/**
 * SORUN #12 Fix — GET /:database/auth/me response'da metadata alanı
 *
 * me.ts GET response: { id, email, role, full_name, avatar_url,
 *                       email_verified, is_active, provider,
 *                       created_at, last_login, metadata }
 *
 * metadata: hassas alanlar (reset_token, magic_token vb.) temizlenmiş JSONB
 * Bu test metadata alanının response'da mevcut olduğunu doğrular.
 */

import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import Fastify from "fastify";
import { JwtService } from "../../src/services/jwtService.js";

// Setup.ts'nin ayarladığı JWT_SECRET ile aynı değeri kullan — me.ts config.JWT_SECRET'ı bunu okur
const JWT_SECRET = "test-secret-must-be-at-least-32-characters";
const TEST_USER_ID = "a1b2c3d4-0000-0000-0000-000000000001";

vi.stubEnv("JWT_SECRET", JWT_SECRET);
vi.stubEnv("ADMIN_SECRET", "test-admin-secret-16ch");

// provision.ts mock'u — ensureAuthSchema DB çağrısını atla
vi.mock("../../src/routes/db/auth/provision.js", () => ({
  ensureAuthSchema: vi.fn().mockResolvedValue(undefined),
  insertAuditLog: vi.fn().mockResolvedValue(undefined),
  getAuthSetting: vi.fn().mockResolvedValue("false"),
}));

// Sahte kullanıcı verisi — DB'den geldiği gibi
const fakeUser = {
  id: TEST_USER_ID,
  email: "alice@test.com",
  role: "editor",
  full_name: "Alice Wonderland",
  avatar_url: null,
  email_verified: true,
  is_active: true,
  provider: "email",
  created_at: "2026-01-01T00:00:00.000Z",
  last_login: "2026-08-10T00:00:00.000Z",
  metadata: { theme: "dark", notifications_enabled: true },
};

let app: ReturnType<typeof Fastify>;
let dbUserToken: string;

beforeAll(async () => {
  const jwtSvc = new JwtService(JWT_SECRET);
  // DB user token (iss: "postgrify/db-auth")
  dbUserToken = await jwtSvc.signDbUserToken("testdb", TEST_USER_ID, "alice@test.com", "editor");

  app = Fastify({ logger: false });

  // sql mock: SELECT FROM _postgrify_auth.users → fakeUser döndür
  const fakeSql = Object.assign(
    async () => [fakeUser], // tagged template query
    {
      unsafe: async () => [fakeUser],
      begin: async (_mode: string, fn: (tx: unknown) => Promise<unknown>) => fn(fakeSql),
    }
  );

  app.decorate("jwtService", jwtSvc);
  app.decorate("poolManager", { getPool: () => fakeSql });
  app.decorate("authenticate", async () => {});
  app.decorate("authenticateAdmin", async () => {});
  app.decorate("authenticateAny", async () => {});
  app.decorate("cache", { get: async () => null, set: async () => {}, del: async () => {}, buildKey: (...p: string[]) => p.join(":"), invalidatePattern: async () => {} });
  app.decorate("settings", { get: async () => null });
  app.decorate("backupService", {});
  app.decorate("backupScheduler", {});
  app.decorateRequest("user", null);
  app.decorateRequest("dbName", null);
  app.decorateRequest("dbUser", null);

  const { authMeRoute } = await import("../../src/routes/db/auth/me.js");
  await app.register(authMeRoute);
  await app.ready();
});

afterAll(async () => {
  await app.close();
  vi.unstubAllEnvs();
});

describe("SORUN #12 — GET /:database/auth/me metadata alanı", () => {
  it("response metadata alanı içermeli", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/testdb/auth/me",
      headers: { authorization: `Bearer ${dbUserToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty("metadata");
  });

  it("tüm profil alanları mevcut olmalı", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/testdb/auth/me",
      headers: { authorization: `Bearer ${dbUserToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body).toHaveProperty("id");
    expect(body).toHaveProperty("email");
    expect(body).toHaveProperty("role");
    expect(body).toHaveProperty("full_name");
    expect(body).toHaveProperty("avatar_url");
    expect(body).toHaveProperty("email_verified");
    expect(body).toHaveProperty("is_active");
    expect(body).toHaveProperty("provider");
    expect(body).toHaveProperty("created_at");
    expect(body).toHaveProperty("last_login");
    expect(body).toHaveProperty("metadata");
  });

  it("token olmadan 401 dönmeli", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/testdb/auth/me",
    });
    expect(res.statusCode).toBe(401);
  });

  it("admin token ile 401 dönmeli (DB user token zorunlu)", async () => {
    const jwtSvc = new JwtService(JWT_SECRET);
    const adminToken = await jwtSvc.signAdminToken();

    const res = await app.inject({
      method: "GET",
      url: "/testdb/auth/me",
      headers: { authorization: `Bearer ${adminToken}` },
    });
    // verifyDbUser admin token'ı reddeder
    expect(res.statusCode).toBe(401);
  });

  it("yanlış database token ile 403 dönmeli", async () => {
    const jwtSvc = new JwtService(JWT_SECRET);
    const wrongDbToken = await jwtSvc.signDbUserToken("otherdb", TEST_USER_ID, "alice@test.com", "editor");

    const res = await app.inject({
      method: "GET",
      url: "/testdb/auth/me",
      headers: { authorization: `Bearer ${wrongDbToken}` },
    });
    expect(res.statusCode).toBe(403);
  });
});