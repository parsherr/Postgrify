/**
 * Issue #8 Fix — DELETE /:database/auth/me self-account deletion
 *
 * users.ts DELETE endpoint (/:database/auth/me):
 * - Requires a DB user token
 * - Revokes all active sessions
 * - Deletes the account → 200 { ok: true, message }
 * - Admin token is rejected (403 — "not a DB-user token")
 * - Wrong DB token is rejected (403 — "Token database mismatch")
 * - 401 without a token
 */

import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import Fastify from "fastify";
import { JwtService } from "../../src/services/jwtService.js";

const JWT_SECRET = "test-secret-must-be-at-least-32-characters";
const ADMIN_SECRET = "test-admin-secret-16ch";
const TEST_USER_ID = "a1b2c3d4-0000-0000-0000-000000000099";

vi.stubEnv("JWT_SECRET", JWT_SECRET);
vi.stubEnv("ADMIN_SECRET", ADMIN_SECRET);

vi.mock("../../src/routes/db/auth/provision.js", () => ({
  ensureAuthSchema: vi.fn().mockResolvedValue(undefined),
  insertAuditLog: vi.fn().mockResolvedValue(undefined),
  getAuthSetting: vi.fn().mockResolvedValue("false"),
}));

let app: ReturnType<typeof Fastify>;
let dbUserToken: string;
let wrongDbToken: string;

beforeAll(async () => {
  const jwtSvc = new JwtService(JWT_SECRET);
  dbUserToken = await jwtSvc.signDbUserToken("testdb", TEST_USER_ID, "test@test.com", "editor");
  wrongDbToken = await jwtSvc.signDbUserToken("wrongdb", TEST_USER_ID, "test@test.com", "editor");

  app = Fastify({ logger: false });

  const fakeSql = Object.assign(
    async () => [{ id: TEST_USER_ID }],
    {
      unsafe: async () => [{ id: TEST_USER_ID }],
      begin: async (_mode: string, fn: (tx: unknown) => Promise<unknown>) => fn(fakeSql),
    }
  );

  app.decorate("jwtService", jwtSvc);
  app.decorate("poolManager", { getPool: () => fakeSql });
  app.decorate("authenticate", async () => {});
  app.decorate("authenticateAdmin", async () => {});
  app.decorate("authenticateAny", async () => {});
  app.decorate("cache", {
    get: async () => null,
    set: async () => {},
    del: async () => {},
    buildKey: (...p: string[]) => p.join(":"),
    invalidatePattern: async () => {},
  });
  app.decorate("settings", { get: async () => null });
  app.decorate("backupService", {});
  app.decorate("backupScheduler", {});
  app.decorateRequest("user", null);
  app.decorateRequest("dbName", null);
  app.decorateRequest("dbUser", null);

  // Set dbName from the URL param — required for req.dbName! in users.ts
  app.addHook("preHandler", async (req) => {
    const params = req.params as Record<string, string>;
    (req as { dbName: string }).dbName = params.database ?? "testdb";
  });

  const { authUsersRoute } = await import("../../src/routes/db/auth/users.js");
  await app.register(authUsersRoute);
  await app.ready();
});

afterAll(async () => {
  await app.close();
  vi.unstubAllEnvs();
});

describe("Issue #8 — DELETE /:database/auth/me account deletion", () => {
  it("returns 200 with a valid DB user token", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: "/testdb/auth/me",
      headers: { authorization: `Bearer ${dbUserToken}` },
    });
    // users.ts DELETE /auth/me → 200 { ok: true, message }
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty("ok", true);
  });

  it("returns 401 without a token", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: "/testdb/auth/me",
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 with an admin token (DB user token is required)", async () => {
    const jwtSvc = new JwtService(JWT_SECRET);
    const adminToken = await jwtSvc.signAdminToken();

    const res = await app.inject({
      method: "DELETE",
      url: "/testdb/auth/me",
      headers: { authorization: `Bearer ${adminToken}` },
    });
    // users.ts: verifyDbUser rejects admin tokens → 403 "not a DB-user token"
    expect(res.statusCode).toBe(403);
  });

  it("returns 403 with a token for the wrong database", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: "/testdb/auth/me",
      headers: { authorization: `Bearer ${wrongDbToken}` },
    });
    expect(res.statusCode).toBe(403);
  });
});
