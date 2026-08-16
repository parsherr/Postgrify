/**
 * Health endpoint integration testi.
 *
 * GET /health → public, minimal { ok: true }
 * GET /ready, GET /health/ready → Postgres ping (E-25)
 * GET /admin/health → admin token gerektirir, detaylı bilgi döner
 *
 * Güvenlik değişikliği: public /health artık uptime/activePools açıklamıyor.
 * Detaylar admin-only /admin/health endpoint'ine taşındı.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";

const sqlMock = vi.fn().mockResolvedValue([{ ok: 1 }]);

// DB ve cache bağlantılarını mock'la
vi.mock("../../src/services/poolManager.js", () => ({
  PoolManager: vi.fn().mockImplementation(() => ({
    getPool: vi.fn().mockReturnValue(sqlMock),
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

  const { PoolManager } = await import("../../src/services/poolManager.js");
  const { CacheService } = await import("../../src/services/cacheService.js");
  server.decorate("poolManager", new PoolManager({} as never));
  server.decorate("cache", new CacheService());
  // authenticateAdmin kasıtlı eklenmedi — healthRoute bu durumu graceful handle etmeli

  const { healthRoute } = await import("../../src/routes/health.js");
  await server.register(healthRoute);
  await server.ready();
});

afterAll(async () => {
  await server.close();
});

describe("GET /health", () => {
  it("200 ve ok:true döner", async () => {
    const res = await server.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
  });

  it("uptime veya activePools bilgisi açıklanmaz (güvenlik)", async () => {
    const res = await server.inject({ method: "GET", url: "/health" });
    const body = res.json();
    // Public endpoint servis detaylarını sızdırmamalı
    expect(body.uptime).toBeUndefined();
    expect(body.activePools).toBeUndefined();
    expect(body.status).toBeUndefined();
  });

  it("JSON Content-Type döner", async () => {
    const res = await server.inject({ method: "GET", url: "/health" });
    expect(res.headers["content-type"]).toMatch(/application\/json/);
  });
});

describe("GET /ready (E-25)", () => {
  it("/ready → 200 ready:true when Postgres ping succeeds", async () => {
    sqlMock.mockResolvedValue([{ ok: 1 }]);
    const res = await server.inject({ method: "GET", url: "/ready" });
    expect(res.statusCode).toBe(200);
    expect(res.json().ready).toBe(true);
  });

  it("/health/ready → aynı davranış", async () => {
    sqlMock.mockResolvedValue([{ ok: 1 }]);
    const res = await server.inject({ method: "GET", url: "/health/ready" });
    expect(res.statusCode).toBe(200);
    expect(res.json().ready).toBe(true);
  });

  it("Postgres ping fail → 503", async () => {
    sqlMock.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const res = await server.inject({ method: "GET", url: "/ready" });
    expect(res.statusCode).toBe(503);
    expect(res.json().ready).toBe(false);
  });
});
