/**
 * Health endpoint integration testi.
 * Fastify sunucusu gerçek olarak ayağa kaldırılır; DB mock'lanır.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";

// DB ve cache bağlantılarını mock'la
vi.mock("../../src/services/poolManager.js", () => ({
  PoolManager: vi.fn().mockImplementation(() => ({
    getPool: vi.fn(),
    closeAll: vi.fn().mockResolvedValue(undefined),
    activePoolCount: 2,
    activePoolNames: ["project1", "project2"],
  })),
}));

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

beforeAll(async () => {
  server = Fastify({ logger: false });

  // Dekoratörleri elle ekle (plugin'ler yerine)
  const { PoolManager } = await import("../../src/services/poolManager.js");
  const { CacheService } = await import("../../src/services/cacheService.js");
  server.decorate("poolManager", new PoolManager({} as never));
  server.decorate("cache", new CacheService());

  const { healthRoute } = await import("../../src/routes/health.js");
  await server.register(healthRoute);
  await server.ready();
});

afterAll(async () => {
  await server.close();
});

describe("GET /health", () => {
  it("200 ve status:ok döner", async () => {
    const res = await server.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe("ok");
  });

  it("uptime sayı döner", async () => {
    const res = await server.inject({ method: "GET", url: "/health" });
    const body = res.json();
    expect(typeof body.uptime).toBe("number");
    expect(body.uptime).toBeGreaterThan(0);
  });

  it("activePools değerini döner", async () => {
    const res = await server.inject({ method: "GET", url: "/health" });
    const body = res.json();
    expect(body.activePools).toBe(2);
  });
});