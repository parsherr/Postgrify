/**
 * GET /admin/stats endpoint testi.
 * poolManager ve postgres mock'lanır.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { JwtService } from "../../src/services/jwtService.js";

const JWT_SECRET = "test-secret-must-be-at-least-32-characters";
const ADMIN_SECRET = "test-admin-secret-16ch";

vi.stubEnv("JWT_SECRET", JWT_SECRET);
vi.stubEnv("ADMIN_SECRET", ADMIN_SECRET);

const MOCK_STATS = [{ total_bytes: "12582912" }];

vi.mock("postgres", () => {
  const sqlMock = vi.fn(() => {
    const fn = vi.fn().mockResolvedValue(MOCK_STATS) as unknown as Record<string, unknown>;
    fn.unsafe = vi.fn().mockResolvedValue(MOCK_STATS);
    fn.end = vi.fn().mockResolvedValue(undefined);
    return fn;
  });
  return { default: sqlMock };
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
  })),
  TTL: { ROW_QUERY: 30, SCHEMA: 300, TABLE_LIST: 120, DB_SIZE: 60 },
}));

let server: FastifyInstance;
let adminToken: string;

beforeAll(async () => {
  server = Fastify({ logger: false });

  const { PoolManager } = await import("../../src/services/poolManager.js");
  const { CacheService } = await import("../../src/services/cacheService.js");

  server.decorate("poolManager", new PoolManager({} as never));
  server.decorate("cache", new CacheService());
  server.decorateRequest("user", null);
  server.decorateRequest("dbName", null);

  const jwtSvc = new JwtService(JWT_SECRET);

  server.decorate("authenticateAdmin", async (req: never, reply: never) => {
    const auth = (req as { headers: Record<string, string> }).headers.authorization;
    if (!auth?.startsWith("Bearer ")) {
      return (reply as { status: (n: number) => { send: (b: unknown) => void } })
        .status(401).send({ error: "Unauthorized" });
    }
    const payload = await jwtSvc.verify(auth.slice(7));
    if (!payload || payload.role !== "admin") {
      return (reply as { status: (n: number) => { send: (b: unknown) => void } })
        .status(403).send({ error: "Admin access required" });
    }
    (req as { user: unknown }).user = payload;
  });

  server.decorate("authenticate", async () => {});

  const { adminRoutes } = await import("../../src/routes/admin/index.js");
  await server.register(adminRoutes, { prefix: "/admin" });
  await server.ready();

  adminToken = await jwtSvc.signAdminToken();
});

afterAll(async () => {
  await server.close();
  vi.unstubAllEnvs();
});

describe("GET /admin/stats", () => {
  it("admin token ile istatistik döner", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/admin/stats",
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(typeof body.uptime).toBe("number");
    expect(typeof body.activePools).toBe("number");
    expect(Array.isArray(body.activePoolNames)).toBe(true);
    expect(typeof body.totalSizeBytes).toBe("number");
    expect(typeof body.nodeVersion).toBe("string");
  });

  it("token olmadan 401 döner", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/admin/stats",
    });
    expect(res.statusCode).toBe(401);
  });

  it("DB token ile 403 döner (admin only)", async () => {
    const jwtSvc = new JwtService(JWT_SECRET);
    const dbToken = await jwtSvc.signDbToken("project1", ["read"]);
    const res = await server.inject({
      method: "GET",
      url: "/admin/stats",
      headers: { Authorization: `Bearer ${dbToken}` },
    });
    expect(res.statusCode).toBe(403);
  });
});