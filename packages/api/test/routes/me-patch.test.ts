/**
 * SORUN #13 Fix — PATCH /:database/auth/me profil güncelleme
 *
 * me.ts PATCH endpoint:
 * - DB user token gerektirir (admin token reddedilir)
 * - Partial update: sadece gönderilen alanlar güncellenir
 * - metadata: merge semantics (üzerine yazılmaz, birleştirilir)
 * - Korunan metadata alanları (reset_token vb.) overwrite edilemez
 * - Boş body → 400
 */

import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import Fastify from "fastify";
import { JwtService } from "../../src/services/jwtService.js";

// setup.ts ile aynı secret — me.ts config.JWT_SECRET'ı bunu okur
const JWT_SECRET = "test-secret-must-be-at-least-32-characters";
const TEST_USER_ID = "a1b2c3d4-0000-0000-0000-000000000002";

vi.stubEnv("JWT_SECRET", JWT_SECRET);
vi.stubEnv("ADMIN_SECRET", "test-admin-secret-16ch");

// provision.ts mock'u
vi.mock("../../src/routes/db/auth/provision.js", () => ({
  ensureAuthSchema: vi.fn().mockResolvedValue(undefined),
  insertAuditLog: vi.fn().mockResolvedValue(undefined),
  getAuthSetting: vi.fn().mockResolvedValue("false"),
}));

// UPDATE RETURNING'den dönen kullanıcı
const fakeUpdated = {
  id: TEST_USER_ID,
  email: "bob@test.com",
  role: "editor",
  full_name: "Bob Updated",
  avatar_url: "https://cdn.example.com/bob.jpg",
  email_verified: true,
  is_active: true,
  provider: "email",
  created_at: "2026-01-01T00:00:00.000Z",
  last_login: "2026-08-10T00:00:00.000Z",
  metadata: { theme: "light" },
};

let app: ReturnType<typeof Fastify>;
let dbUserToken: string;

beforeAll(async () => {
  const jwtSvc = new JwtService(JWT_SECRET);
  dbUserToken = await jwtSvc.signDbUserToken("testdb", TEST_USER_ID, "bob@test.com", "editor");

  app = Fastify({ logger: false });

  // sql mock: UPDATE RETURNING → fakeUpdated döndür
  const fakeSql = Object.assign(
    async () => [fakeUpdated],
    {
      unsafe: async () => [fakeUpdated],
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

describe("SORUN #13 — PATCH /:database/auth/me profil güncelleme", () => {
  it("full_name güncelleme başarılı olmalı (200)", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/testdb/auth/me",
      headers: { authorization: `Bearer ${dbUserToken}` },
      payload: { full_name: "Bob Updated" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty("id");
    expect(body).toHaveProperty("full_name");
    expect(body).toHaveProperty("metadata");
  });

  it("avatar_url güncelleme başarılı olmalı (200)", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/testdb/auth/me",
      headers: { authorization: `Bearer ${dbUserToken}` },
      payload: { avatar_url: "https://cdn.example.com/bob.jpg" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty("avatar_url");
  });

  it("metadata güncelleme başarılı olmalı (200)", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/testdb/auth/me",
      headers: { authorization: `Bearer ${dbUserToken}` },
      payload: { metadata: { theme: "light" } },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty("metadata");
  });

  it("partial update: sadece bir alan gönderilebilmeli", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/testdb/auth/me",
      headers: { authorization: `Bearer ${dbUserToken}` },
      payload: { full_name: "Only Name Changed" },
    });

    expect(res.statusCode).toBe(200);
  });

  it("full_name + avatar_url + metadata birlikte gönderilebilmeli", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/testdb/auth/me",
      headers: { authorization: `Bearer ${dbUserToken}` },
      payload: {
        full_name: "Full Update",
        avatar_url: "https://example.com/avatar.png",
        metadata: { theme: "dark", lang: "tr" },
      },
    });

    expect(res.statusCode).toBe(200);
  });

  it("boş body → 400 dönmeli", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/testdb/auth/me",
      headers: { authorization: `Bearer ${dbUserToken}`, "content-type": "application/json" },
      payload: {},
    });

    expect(res.statusCode).toBe(400);
  });

  it("token olmadan 401 dönmeli", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/testdb/auth/me",
      payload: { full_name: "No Token" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("admin token ile 401 dönmeli (DB user token zorunlu)", async () => {
    const jwtSvc = new JwtService(JWT_SECRET);
    const adminToken = await jwtSvc.signAdminToken();

    const res = await app.inject({
      method: "PATCH",
      url: "/testdb/auth/me",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { full_name: "Admin Try" },
    });
    // verifyDbUser admin token'ı reddeder
    expect(res.statusCode).toBe(401);
  });

  it("yanlış database token ile 403 dönmeli", async () => {
    const jwtSvc = new JwtService(JWT_SECRET);
    const wrongDbToken = await jwtSvc.signDbUserToken("wrongdb", TEST_USER_ID, "bob@test.com", "editor");

    const res = await app.inject({
      method: "PATCH",
      url: "/testdb/auth/me",
      headers: { authorization: `Bearer ${wrongDbToken}` },
      payload: { full_name: "Wrong DB" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("additionalProperties false — bilinmeyen alan reddedilmeli (400)", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/testdb/auth/me",
      headers: { authorization: `Bearer ${dbUserToken}` },
      payload: { role: "admin" }, // role değiştirmeye çalışıyor — yasak
    });
    // JSON schema additionalProperties: false → 400
    expect(res.statusCode).toBe(400);
  });
});