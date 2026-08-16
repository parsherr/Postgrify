/**
 * C-03 — PATCH /db/:database/:table Prefer: return
 * where filter remains required (ADR-009 / X-Postgrify-Require-Filter).
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { JwtService } from "../../src/services/jwtService.js";

const JWT_SECRET = "test-secret-must-be-at-least-32-characters";
vi.stubEnv("JWT_SECRET", JWT_SECRET);
vi.stubEnv("ADMIN_SECRET", "test-admin-secret-16ch");

const MOCK_UPDATED = [{ id: 1, name: "Updated", status: "inactive" }];
const unsafeCalls: { sql: string; params?: unknown[] }[] = [];

vi.mock("postgres", () => {
  const sqlMock = vi.fn(() => {
    const fn = vi.fn().mockResolvedValue(MOCK_UPDATED) as unknown as Record<string, unknown>;
    fn.unsafe = vi.fn().mockImplementation((sql: string, params?: unknown[]) => {
      unsafeCalls.push({ sql, params });
      return Promise.resolve(MOCK_UPDATED);
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
let writeToken: string;

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
  writeToken = await new JwtService(JWT_SECRET).signDbToken("project1", ["write"]);
});

afterAll(async () => { await server.close(); vi.unstubAllEnvs(); });
beforeEach(() => { unsafeCalls.length = 0; });

describe("C-03 PATCH Prefer: return", () => {
  it("default minimal → 204, no {updated} wrapper", async () => {
    const res = await server.inject({
      method: "PATCH",
      url: "/db/project1/users?where=status.eq.inactive",
      headers: { Authorization: `Bearer ${writeToken}` },
      payload: { is_active: false },
    });
    expect(res.statusCode).toBe(204);
    expect(res.body).toBe("");
    expect(res.headers["x-postgrify-require-filter"]).toBe("true");
    expect(unsafeCalls[0].sql).not.toMatch(/RETURNING/i);
  });

  it("Prefer: return=representation → 200 + array", async () => {
    const res = await server.inject({
      method: "PATCH",
      url: "/db/project1/users?where=id.eq.1",
      headers: {
        Authorization: `Bearer ${writeToken}`,
        Prefer: "return=representation",
      },
      payload: { name: "Updated" },
    });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
    expect(unsafeCalls[0].sql).toMatch(/RETURNING \*/i);
  });

  it("where required → 400", async () => {
    const res = await server.inject({
      method: "PATCH",
      url: "/db/project1/users",
      headers: { Authorization: `Bearer ${writeToken}` },
      payload: { name: "x" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("bind params for values", async () => {
    const evil = "x'; DROP TABLE users;--";
    const res = await server.inject({
      method: "PATCH",
      url: "/db/project1/users?where=id.eq.1",
      headers: { Authorization: `Bearer ${writeToken}` },
      payload: { name: evil },
    });
    expect(res.statusCode).toBe(204);
    expect(unsafeCalls[0].sql).not.toMatch(/DROP TABLE/);
    expect(unsafeCalls[0].params).toContain(evil);
  });
});
