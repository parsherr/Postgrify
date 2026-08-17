/**
 * Issue #12 Fix — metadata field in GET /:database/auth/me response
 *
 * me.ts GET response: { id, email, role, full_name, avatar_url,
 *                       email_verified, is_active, provider,
 *                       created_at, last_login, metadata }
 *
 * metadata: JSONB with sensitive fields (reset_token, magic_token, etc.) stripped
 * This test verifies that the metadata field is present in the response.
 */

import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import Fastify from "fastify";
import { JwtService } from "../../src/services/jwtService.js";

// Use the same JWT_SECRET value that setup.ts sets — me.ts reads config.JWT_SECRET from this
const JWT_SECRET = "test-secret-must-be-at-least-32-characters";
const TEST_USER_ID = "a1b2c3d4-0000-0000-0000-000000000001";

vi.stubEnv("JWT_SECRET", JWT_SECRET);
vi.stubEnv("ADMIN_SECRET", "test-admin-secret-16ch");

// provision.ts mock — skip the ensureAuthSchema DB call
vi.mock("../../src/routes/db/auth/provision.js", () => ({
  ensureAuthSchema: vi.fn().mockResolvedValue(undefined),
  insertAuditLog: vi.fn().mockResolvedValue(undefined),
  getAuthSetting: vi.fn().mockResolvedValue("false"),
}));

// Fake user data — as returned from the DB
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

  // sql mock: SELECT FROM _postgrify_auth.users → returns fakeUser
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

describe("Issue #12 — GET /:database/auth/me metadata field", () => {
  it("response should include a metadata field", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/testdb/auth/me",
      headers: { authorization: `Bearer ${dbUserToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty("metadata");
  });

  it("all profile fields should be present", async () => {
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

  it("should return 401 without a token", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/testdb/auth/me",
    });
    expect(res.statusCode).toBe(401);
  });

  it("should return 401 with an admin token (DB user token is required)", async () => {
    const jwtSvc = new JwtService(JWT_SECRET);
    const adminToken = await jwtSvc.signAdminToken();

    const res = await app.inject({
      method: "GET",
      url: "/testdb/auth/me",
      headers: { authorization: `Bearer ${adminToken}` },
    });
    // verifyDbUser rejects admin tokens
    expect(res.statusCode).toBe(401);
  });

  it("should return 403 with a token for the wrong database", async () => {
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