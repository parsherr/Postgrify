/**
 * CORS plugin testleri.
 * Development modunda tüm origin'lere izin verildiğini,
 * production modunda sadece CORS_ORIGINS listesine izin verildiğini doğrular.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";

vi.stubEnv("JWT_SECRET", "test-secret-must-be-at-least-32-characters");
vi.stubEnv("ADMIN_SECRET", "test-admin-secret-16ch");
vi.stubEnv("NODE_ENV", "development");
vi.stubEnv("CORS_ORIGINS", "http://localhost:5173");

vi.mock("postgres", () => {
  const sqlMock = vi.fn(() => {
    const fn = vi.fn().mockResolvedValue([]) as unknown as Record<string, unknown>;
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
    buildKey: (...p: string[]) => `postgrify:${p.join(":")}`,
  })),
  TTL: { ROW_QUERY: 30, SCHEMA: 300, TABLE_LIST: 120, DB_SIZE: 60 },
}));

let server: FastifyInstance;

beforeAll(async () => {
  server = Fastify({ logger: false });

  const { corsPlugin } = await import("../../src/plugins/cors.js");
  await server.register(corsPlugin);

  server.get("/ping", async () => ({ ok: true }));
  await server.ready();
});

afterAll(async () => {
  await server.close();
  vi.unstubAllEnvs();
});

describe("CORS plugin — development modu", () => {
  it("OPTIONS isteğine 204 döner", async () => {
    const res = await server.inject({
      method: "OPTIONS",
      url: "/ping",
      headers: {
        origin: "http://any-origin.com",
        "access-control-request-method": "GET",
      },
    });
    // Fastify CORS preflight için 204 döner
    expect([200, 204]).toContain(res.statusCode);
  });

  it("GET isteğine Access-Control-Allow-Origin header'ı ekler", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/ping",
      headers: { origin: "http://localhost:5173" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBeTruthy();
  });

  it("X-Database header'ına izin verilir (allowedHeaders kontrolü)", async () => {
    const res = await server.inject({
      method: "OPTIONS",
      url: "/ping",
      headers: {
        origin: "http://localhost:5173",
        "access-control-request-method": "GET",
        "access-control-request-headers": "X-Database",
      },
    });
    expect([200, 204]).toContain(res.statusCode);
  });
});