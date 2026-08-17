/**
 * apiKeyGuard middleware tests.
 *
 * Guard is skipped when a Bearer token is present.
 * Validated via X-API-Key — missing/wrong/invalid cases are tested.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import Fastify, { type FastifyInstance, type FastifyRequest, type FastifyReply } from "fastify";
import { JwtService } from "../../../src/services/jwtService.js";

const JWT_SECRET = "test-secret-must-be-at-least-32-characters";

// provision.ts mock — for getApiKey checks
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

  // Set up a minimal route to test apiKeyGuard directly
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
    it("guard is skipped and returns 200 when a Bearer token is present", async () => {
      mockGetApiKey.mockResolvedValue("valid-key-abc123");

      const res = await server.inject({
        method: "GET",
        url: "/testdb/probe",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true });
    });

    it("passes even if X-API-Key is missing when a Bearer token is present", async () => {
      mockGetApiKey.mockResolvedValue("valid-key-abc123");

      const res = await server.inject({
        method: "GET",
        url: "/testdb/probe",
        headers: { authorization: `Bearer ${adminToken}` },
        // X-API-Key header is absent
      });

      expect(res.statusCode).toBe(200);
    });
  });

  describe("X-API-Key requirement", () => {
    it("returns 401 when neither Bearer nor X-API-Key is present", async () => {
      mockGetApiKey.mockResolvedValue("valid-key-abc123");

      const res = await server.inject({
        method: "GET",
        url: "/testdb/probe",
        // No headers at all
      });

      expect(res.statusCode).toBe(401);
      expect(res.json().error).toContain("Missing X-API-Key");
    });

    it("returns 401 with an incorrect X-API-Key", async () => {
      mockGetApiKey.mockResolvedValue("correct-key-abc123");

      const res = await server.inject({
        method: "GET",
        url: "/testdb/probe",
        headers: { "x-api-key": "wrong-key" },
      });

      expect(res.statusCode).toBe(401);
      expect(res.json().error).toContain("Invalid API key");
    });

    it("returns 200 with the correct X-API-Key", async () => {
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

  describe("Schema not yet provisioned", () => {
    it("returns 503 when getApiKey returns null", async () => {
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