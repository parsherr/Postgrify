/**
 * apiKeyGuard middleware testleri.
 *
 * Bearer token varsa guard atlanır.
 * X-API-Key ile doğrulanır — eksik/yanlış/geçersiz durumlar test edilir.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import Fastify, { type FastifyInstance, type FastifyRequest, type FastifyReply } from "fastify";
import { JwtService } from "../../../src/services/jwtService.js";

const JWT_SECRET = "test-secret-must-be-at-least-32-characters";

// provision.ts mock — getApiKey kontrolü için
const mockGetApiKey = vi.fn();

vi.mock("../../../src/routes/db/auth/provision.js", () => ({
  ensureAuthSchema: vi.fn().mockResolvedValue(undefined),
  getApiKey: mockGetApiKey,
  getAuthSetting: vi.fn().mockResolvedValue("true"),
  insertAuditLog: vi.fn().mockResolvedValue(undefined),
  provisionApiKey: vi.fn().mockResolvedValue("valid-key-abc123"),
}));

vi.mock("postgres", () => {
  const sqlFn = vi.fn().mockResolvedValue([]);
  sqlFn.unsafe = vi.fn().mockResolvedValue([]);
  sqlFn.end = vi.fn().mockResolvedValue(undefined);
  return { default: vi.fn(() => sqlFn) };
});

vi.mock("../../../src/services/cacheService.js", () => ({
  CacheService: vi.fn().mockImplementation(() => ({
    connect: vi.fn(), disconnect: vi.fn(),
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn(), del: vi.fn(), invalidatePattern: vi.fn(),
    buildKey: (...p: string[]) => `postgrify:${p.join(":")}`,
    redisClient: null,
  })),
  TTL: { ROW_QUERY: 30, SCHEMA: 300, TABLE_LIST: 120, DB_SIZE: 60 },
}));

let server: FastifyInstance;
let adminToken: string;

beforeAll(async () => {
  const jwtSvc = new JwtService(JWT_SECRET);
  adminToken = await jwtSvc.signAdminToken();

  server = Fastify({ logger: false });

  const { PoolManager } = await import("../../../src/services/poolManager.js");
  const { CacheService } = await import("../../../src/services/cacheService.js");

  server.decorate("poolManager", new PoolManager({} as never));
  server.decorate("cache", new CacheService());
  server.decorateRequest("user", null);
  server.decorateRequest("dbName", null);
  server.decorate("authenticate", async (_req: FastifyRequest, _reply: FastifyReply) => {});
  server.decorate("authenticateAdmin", async () => {});

  // apiKeyGuard'ı doğrudan test etmek için minimal bir route kur
  const { apiKeyGuard } = await import("../../../src/middleware/apiKeyGuard.js");
  const { dbResolverHook } = await import("../../../src/middleware/dbResolver.js");

  server.get(
    "/:database/probe",
    {
      preHandler: [dbResolverHook, apiKeyGuard],
    },
    async (_req, reply) => reply.send({ ok: true })
  );

  await server.ready();
});

afterAll(async () => {
  await server.close();
});

describe("apiKeyGuard", () => {
  describe("Bearer token bypass", () => {
    it("Bearer token varsa guard atlanır ve 200 döner", async () => {
      mockGetApiKey.mockResolvedValue("valid-key-abc123");

      const res = await server.inject({
        method: "GET",
        url: "/testdb/probe",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true });
    });

    it("Bearer token varken X-API-Key eksik olsa bile geçer", async () => {
      mockGetApiKey.mockResolvedValue("valid-key-abc123");

      const res = await server.inject({
        method: "GET",
        url: "/testdb/probe",
        headers: { authorization: `Bearer ${adminToken}` },
        // X-API-Key header YOK
      });

      expect(res.statusCode).toBe(200);
    });
  });

  describe("X-API-Key zorunluluğu", () => {
    it("Ne Bearer ne X-API-Key varsa 401 döner", async () => {
      mockGetApiKey.mockResolvedValue("valid-key-abc123");

      const res = await server.inject({
        method: "GET",
        url: "/testdb/probe",
        // Hiç header yok
      });

      expect(res.statusCode).toBe(401);
      expect(res.json().error).toContain("Missing X-API-Key");
    });

    it("Yanlış X-API-Key ile 401 döner", async () => {
      mockGetApiKey.mockResolvedValue("correct-key-abc123");

      const res = await server.inject({
        method: "GET",
        url: "/testdb/probe",
        headers: { "x-api-key": "wrong-key" },
      });

      expect(res.statusCode).toBe(401);
      expect(res.json().error).toContain("Invalid API key");
    });

    it("Doğru X-API-Key ile 200 döner", async () => {
      const correctKey = "correct-key-abc123456789";
      mockGetApiKey.mockResolvedValue(correctKey);

      const res = await server.inject({
        method: "GET",
        url: "/testdb/probe",
        headers: { "x-api-key": correctKey },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true });
    });
  });

  describe("Schema provision edilmemiş durum", () => {
    it("getApiKey null döndürürse 503 döner", async () => {
      mockGetApiKey.mockResolvedValue(null);

      const res = await server.inject({
        method: "GET",
        url: "/testdb/probe",
        headers: { "x-api-key": "any-key" },
      });

      expect(res.statusCode).toBe(503);
      expect(res.json().error).toContain("not yet initialized");
    });
  });
});