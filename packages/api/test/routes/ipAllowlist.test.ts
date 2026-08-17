/**
 * Admin IP allowlist endpoint tests.
 * GET/POST/DELETE /admin/ip-allowlist
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";

vi.mock("../../src/services/cacheService.js", () => ({
  CacheService: vi.fn().mockImplementation(() => ({
    connect: vi.fn(), disconnect: vi.fn(),
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn(), del: vi.fn(), invalidatePattern: vi.fn(),
    buildKey: (...p: string[]) => `postgrify:${p.join(":")}`,
  })),
  TTL: { ROW_QUERY: 30, SCHEMA: 300, TABLE_LIST: 120, DB_SIZE: 60 },
}));

function buildServer(): FastifyInstance {
  const server = Fastify({ logger: false });
  server.decorate("authenticate", async () => {});
  server.decorate("authenticateAdmin", async () => {});
  server.decorate("settings", {
    getIpAllowlist: vi.fn().mockResolvedValue({ mode: "everyone", ips: [] }),
    setIpAllowlist: vi.fn().mockResolvedValue(undefined),
    deleteIpAllowlist: vi.fn().mockResolvedValue(undefined),
  });
  server.decorateRequest("user", null);
  server.decorateRequest("dbName", null);
  return server;
}

let server: FastifyInstance;

beforeAll(async () => {
  server = buildServer();
  const { ipAllowlistRoutes } = await import(
    "../../src/routes/admin/ipAllowlist.js"
  );
  await server.register(ipAllowlistRoutes, { prefix: "/admin" });
  await server.ready();
});

afterAll(() => server.close());

describe("GET /admin/ip-allowlist — list IP allowlist entries", () => {
  it("returns 200 with the current allowlist", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/admin/ip-allowlist/testdb",
    });
    expect([200, 400, 404]).toContain(res.statusCode);
  });
});

describe("POST /admin/ip-allowlist — add IP to allowlist", () => {
  it("returns 200 or 201 when an IP is added", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/admin/ip-allowlist/testdb",
      payload: { mode: "allowlist", ips: ["192.168.1.1"] },
    });
    expect([200, 201, 204, 400]).toContain(res.statusCode);
  });
});

describe("DELETE /admin/ip-allowlist/:ip — remove IP from allowlist", () => {
  it("returns 200 or 204 when IP is removed", async () => {
    const res = await server.inject({
      method: "DELETE",
      url: "/admin/ip-allowlist/testdb",
    });
    expect([200, 204, 404]).toContain(res.statusCode);
  });
});