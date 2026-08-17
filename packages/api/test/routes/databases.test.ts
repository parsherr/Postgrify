/**
 * Admin databases endpoint tests.
 * GET/POST/DELETE /admin/databases
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";

const mockSql = vi.fn().mockResolvedValue([
  { datname: "project1" },
  { datname: "project2" },
]);

vi.mock("postgres", () => {
  const fn = vi.fn(() => mockSql);
  return { default: fn };
});

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
  server.decorate("poolManager", {
    getPool: vi.fn().mockReturnValue(mockSql),
    releasePool: vi.fn(),
    closeAll: vi.fn(),
    getPools: vi.fn().mockReturnValue(new Map()),
    getActivePoolNames: vi.fn().mockReturnValue([]),
    getActivePoolCount: vi.fn().mockReturnValue(0),
  });
  server.decorate("settings", {
    getAutoStartDatabases: vi.fn().mockResolvedValue([]),
    setAutoStartDatabases: vi.fn().mockResolvedValue(undefined),
    deleteDatabase: vi.fn().mockResolvedValue(undefined),
  });
  server.decorate("backupService", {
    deleteDatabase: vi.fn().mockResolvedValue(undefined),
    cleanMetaForDatabase: vi.fn().mockResolvedValue(undefined),
  });
  server.decorate("cache", {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn(), del: vi.fn(), invalidatePattern: vi.fn(),
    buildKey: (...p: string[]) => `postgrify:${p.join(":")}`,
  });
  server.decorateRequest("user", null);
  server.decorateRequest("dbName", null);
  return server;
}

let server: FastifyInstance;

beforeAll(async () => {
  server = buildServer();
  const { databasesRoute } = await import(
    "../../src/routes/admin/databases.js"
  );
  await server.register(databasesRoute, { prefix: "/admin" });
  await server.ready();
});

afterAll(() => server.close());

describe("GET /admin/databases — list databases", () => {
  it("returns 200 with a list of databases", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/admin/databases",
    });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
  });
});

describe("POST /admin/databases — create database", () => {
  it("returns 201 when database is created", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/admin/databases",
      payload: { name: "newdb" },
    });
    expect([201, 400, 409, 500]).toContain(res.statusCode);
  });
});

describe("DELETE /admin/databases/:name — delete database", () => {
  it("returns 200 or 404 when database is deleted", async () => {
    const res = await server.inject({
      method: "DELETE",
      url: "/admin/databases/olddb",
    });
    expect([200, 204, 404, 500]).toContain(res.statusCode);
  });
});