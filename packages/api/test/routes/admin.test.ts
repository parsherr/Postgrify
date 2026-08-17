/**
 * Admin route tests — DB list, creation, deletion, schema-cache reload.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { JwtService } from "../../src/services/jwtService.js";

const JWT_SECRET = "test-secret-must-be-at-least-32-characters";

vi.stubEnv("JWT_SECRET", JWT_SECRET);
vi.stubEnv("ADMIN_SECRET", "test-admin-secret-16ch");

const MOCK_DATABASES = [
  { name: "project1", size_bytes: 8192, table_count: 3 },
  { name: "project2", size_bytes: 4096, table_count: 1 },
];

vi.mock("postgres", () => {
  const sqlFn = vi.fn().mockResolvedValue(MOCK_DATABASES) as unknown as Record<string, unknown>;
  sqlFn.unsafe = vi.fn().mockResolvedValue([]);
  sqlFn.end = vi.fn().mockResolvedValue(undefined);
  const ctor = vi.fn(() => sqlFn);
  return { default: ctor };
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
    redisClient: null,
  })),
  TTL: { ROW_QUERY: 30, SCHEMA: 300, TABLE_LIST: 120, DB_SIZE: 60 },
}));

let server: FastifyInstance;
let adminToken: string;
let dbToken: string;

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

  server.decorate("authenticate", async () => {});
  server.decorate("authenticateAdmin", async (req: never, reply: never) => {
    const auth = (req as { headers: Record<string, string> }).headers.authorization;
    if (!auth?.startsWith("Bearer ")) {
      return (reply as { status: (n: number) => { send: (b: unknown) => void } })
        .status(401).send({ error: "Unauthorized" });
    }
    const payload = await jwtSvc.verify(auth.slice(7));
    if (!payload || payload.role !== "admin") {
      return (reply as { status: (n: number) => { send: (b: unknown) => void } })
        .status(403).send({ error: "Admin required" });
    }
    (req as { user: unknown }).user = payload;
  });

  const { adminRoutes } = await import("../../src/routes/admin/index.js");
  await server.register(adminRoutes, { prefix: "/admin" });
  await server.ready();

  const jwtSvcDirect = new JwtService(JWT_SECRET);
  adminToken = await jwtSvcDirect.signAdminToken();
  dbToken = await jwtSvcDirect.signDbToken("project1", ["read"]);
});

afterAll(async () => {
  await server.close();
  vi.unstubAllEnvs();
});

describe("GET /admin/databases", () => {
  it("returns the list with an admin token", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/admin/databases",
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(200);
  });

  it("returns 401 without a token", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/admin/databases",
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 with a DB token", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/admin/databases",
      headers: { Authorization: `Bearer ${dbToken}` },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("POST /admin/databases", () => {
  it("returns 400 for an invalid DB name", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/admin/databases",
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: { name: "123-invalid!" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 201 with a valid name", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/admin/databases",
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: { name: "new_project" },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().name).toBe("new_project");
  });
});

describe("POST /admin/databases/:db/schema-cache/reload (E-27)", () => {
  it("admin → 204 and invalidates db cache prefix", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/admin/databases/project1/schema-cache/reload",
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(204);
    expect(res.body).toBe("");
    expect(server.cache.invalidatePattern).toHaveBeenCalledWith(
      "postgrify:project1:*"
    );
  });

  it("invalid db name → 400", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/admin/databases/bad-name!/schema-cache/reload",
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(400);
  });

  it("DB token → 403", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/admin/databases/project1/schema-cache/reload",
      headers: { Authorization: `Bearer ${dbToken}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it("no token → 401", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/admin/databases/project1/schema-cache/reload",
    });
    expect(res.statusCode).toBe(401);
  });
});
