/**
 * C-04 — DELETE /db/:database/:table Prefer: return
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { JwtService } from "../../src/services/jwtService.js";

const JWT_SECRET = "test-secret-must-be-at-least-32-characters";
vi.stubEnv("JWT_SECRET", JWT_SECRET);
vi.stubEnv("ADMIN_SECRET", "test-admin-secret-16ch");

const MOCK_DELETED = [{ id: 5, status: "deleted" }];
const unsafeCalls: { sql: string }[] = [];

vi.mock("postgres", () => {
  const sqlMock = vi.fn(() => {
    const fn = vi.fn().mockResolvedValue(MOCK_DELETED) as unknown as Record<string, unknown>;
    fn.unsafe = vi.fn().mockImplementation((sql: string) => {
      unsafeCalls.push({ sql });
      return Promise.resolve(MOCK_DELETED);
    });
    fn.end = vi.fn().mockResolvedValue(undefined);
    fn.begin = vi.fn().mockImplementation((_m: string, cb: (t: unknown) => unknown) => cb({ unsafe: fn.unsafe }));
    return fn;
  });
  return { default: sqlMock };
});

vi.mock("../../src/services/cacheService.js", () => ({
  CacheService: vi.fn().mockImplementation(() => ({
    connect: vi.fn(), disconnect: vi.fn(), get: vi.fn().mockResolvedValue(null),
    set: vi.fn(), del: vi.fn(), invalidatePattern: vi.fn(),
    buildKey: (...p: string[]) => `postgrify:${p.join(":")}`,
  })),
  TTL: { ROW_QUERY: 30, SCHEMA: 300, TABLE_LIST: 120, DB_SIZE: 60 },
}));

let server: FastifyInstance;
let deleteToken: string;

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
      return (reply as { status: (n: number) => { send: (b: unknown) => void } }).status(401).send({ error: "Unauthorized" });
    }
    const payload = await jwtSvc.verifyAdminOrDb(auth.slice(7));
    if (!payload) return (reply as { status: (n: number) => { send: (b: unknown) => void } }).status(401).send({ error: "Invalid" });
    (req as { user: unknown }).user = payload;
  });
  server.decorate("authenticateAdmin", async () => {});
  server.decorate("authenticateAny", async (req: never, reply: never) => {
    return (server as never as { authenticate: (r: never, rep: never) => Promise<void> }).authenticate(req, reply);
  });
  const { dbRoutes } = await import("../../src/routes/db/index.js");
  await server.register(dbRoutes, { prefix: "/db" });
  await server.ready();
  deleteToken = await new JwtService(JWT_SECRET).signDbToken("project1", ["delete"]);
});

afterAll(async () => { await server.close(); vi.unstubAllEnvs(); });
beforeEach(() => { unsafeCalls.length = 0; });

describe("C-04 DELETE Prefer: return", () => {
  it("default minimal → 204", async () => {
    const res = await server.inject({
      method: "DELETE",
      url: "/db/project1/users?where=status.eq.deleted",
      headers: { Authorization: `Bearer ${deleteToken}` },
    });
    expect(res.statusCode).toBe(204);
    expect(res.body).toBe("");
    expect(res.headers["x-postgrify-require-filter"]).toBe("true");
    expect(unsafeCalls[0].sql).not.toMatch(/RETURNING/i);
  });

  it("Prefer: return=representation → 200 + array", async () => {
    const res = await server.inject({
      method: "DELETE",
      url: "/db/project1/users?where=id.eq.5",
      headers: {
        Authorization: `Bearer ${deleteToken}`,
        Prefer: "return=representation",
      },
    });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
    expect(unsafeCalls[0].sql).toMatch(/RETURNING \*/i);
  });

  it("where required → 400", async () => {
    const res = await server.inject({
      method: "DELETE",
      url: "/db/project1/users",
      headers: { Authorization: `Bearer ${deleteToken}` },
    });
    expect(res.statusCode).toBe(400);
  });
});
