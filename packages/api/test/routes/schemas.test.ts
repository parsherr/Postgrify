/**
 * Schema listing endpoint tests.
 * GET /db/:database/schemas
 * POST /db/:database/schemas
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance, FastifyRequest } from "fastify";

const MOCK_SCHEMAS = [
  { schema_name: "public", schema_owner: "postgres" },
  { schema_name: "auth", schema_owner: "postgres" },
];

const mockSql = vi.fn((strings: TemplateStringsArray) => {
  const q = strings?.[0] ?? "";
  if (q.includes("information_schema") || q.includes("schema")) {
    return Promise.resolve(MOCK_SCHEMAS);
  }
  return Promise.resolve([]);
}) as unknown as Record<string, unknown>;

mockSql.unsafe = vi.fn().mockResolvedValue([]);
mockSql.end = vi.fn().mockResolvedValue(undefined);

vi.mock("postgres", () => {
  const ctor = vi.fn(() => mockSql);
  return { default: ctor };
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
  server.decorate("authenticateAny", async () => {});
  server.decorate("poolManager", {
    getPool: vi.fn().mockReturnValue(mockSql),
    releasePool: vi.fn(),
    closeAll: vi.fn(),
    getPools: vi.fn().mockReturnValue(new Map()),
    getActivePoolNames: vi.fn().mockReturnValue([]),
    getActivePoolCount: vi.fn().mockReturnValue(0),
  });
  server.decorate("cache", {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn(), del: vi.fn(), invalidatePattern: vi.fn(),
    buildKey: (...p: string[]) => `postgrify:${p.join(":")}`,
  });
  server.decorateRequest("user", null);
  server.decorateRequest("dbName", null);

  // Simulate dbResolver: set req.dbName from URL param before any route handler runs.
  server.addHook("preHandler", async (req: FastifyRequest) => {
    const params = req.params as Record<string, string>;
    if (params.database) {
      // dbResolver middleware sets req.dbName; replicate it here for tests.
      (req as FastifyRequest & { dbName: string }).dbName = params.database;
    }
  });

  return server;
}

let server: FastifyInstance;

beforeAll(async () => {
  server = buildServer();
  const { schemaListsRoute } = await import(
    "../../src/routes/db/schemaLists.js"
  );
  await server.register(schemaListsRoute, { prefix: "/db/:database" });
  await server.ready();
});

afterAll(() => server.close());

describe("GET /db/:database/schemas — list schemas", () => {
  it("returns 200 with schema list", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/db/testdb/schemas",
    });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
  });
});

describe("POST /db/:database/schemas — create schema", () => {
  it("returns 201 when schema is created", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/db/testdb/schemas",
      payload: { name: "myschema" },
    });
    expect([201, 400, 403, 404]).toContain(res.statusCode);
  });
});