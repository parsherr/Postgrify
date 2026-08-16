/**
 * E-76 / E-77 extension route tests.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { JwtService } from "../../src/services/jwtService.js";

const JWT_SECRET = "test-secret-must-be-at-least-32-characters";

vi.stubEnv("JWT_SECRET", JWT_SECRET);
vi.stubEnv("ADMIN_SECRET", "test-admin-secret-16ch");

const MOCK_EXTENSIONS = [
  {
    name: "pg_trgm",
    installed_version: null,
    default_version: "1.6",
    installed: false,
  },
  {
    name: "plpgsql",
    installed_version: "1.0",
    default_version: "1.0",
    installed: true,
  },
];

const { mockUnsafe, mockCacheDel } = vi.hoisted(() => ({
  mockUnsafe: vi.fn().mockResolvedValue([]),
  mockCacheDel: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("postgres", () => {
  const sqlFn = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
    const q = strings?.join?.(" ") ?? strings?.[0] ?? "";
    if (q.includes("pg_available_extensions") && q.includes("WHERE")) {
      const name = values[0];
      if (name === "pg_trgm") {
        return Promise.resolve([
          {
            name: "pg_trgm",
            installed_version: "1.6",
            default_version: "1.6",
            installed: true,
          },
        ]);
      }
      if (name === "uuid-ossp") {
        return Promise.resolve([
          {
            name: "uuid-ossp",
            installed_version: "1.1",
            default_version: "1.1",
            installed: true,
          },
        ]);
      }
      return Promise.resolve([]);
    }
    if (q.includes("pg_available_extensions")) {
      return Promise.resolve(MOCK_EXTENSIONS);
    }
    return Promise.resolve([]);
  }) as unknown as Record<string, unknown>;
  sqlFn.unsafe = mockUnsafe;
  sqlFn.end = vi.fn().mockResolvedValue(undefined);
  return { default: vi.fn(() => sqlFn) };
});

vi.mock("../../src/services/cacheService.js", () => ({
  CacheService: vi.fn().mockImplementation(() => ({
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
    del: mockCacheDel,
    invalidatePattern: vi.fn().mockResolvedValue(undefined),
    buildKey: (...p: string[]) => `postgrify:${p.join(":")}`,
  })),
  TTL: { ROW_QUERY: 30, SCHEMA: 300, TABLE_LIST: 120, DB_SIZE: 60 },
}));

let server: FastifyInstance;
let adminToken: string;
let readToken: string;
let schemaToken: string;

beforeAll(async () => {
  server = Fastify({ logger: false });

  const { PoolManager } = await import("../../src/services/poolManager.js");
  const { CacheService } = await import("../../src/services/cacheService.js");

  server.decorate("poolManager", new PoolManager({} as never));
  server.decorate("cache", new CacheService());
  server.decorateRequest("user", null);
  server.decorateRequest("dbName", null);

  const jwtSvc = new JwtService(JWT_SECRET);

  server.decorate("authenticate", async (req: never, reply: never) => {
    const auth = (req as { headers: Record<string, string> }).headers
      .authorization;
    if (!auth?.startsWith("Bearer ")) {
      return (
        reply as { status: (n: number) => { send: (b: unknown) => void } }
      )
        .status(401)
        .send({ error: "Unauthorized" });
    }
    const payload = await jwtSvc.verify(auth.slice(7));
    if (!payload) {
      return (
        reply as { status: (n: number) => { send: (b: unknown) => void } }
      )
        .status(401)
        .send({ error: "Invalid token" });
    }
    (req as { user: unknown }).user = payload;
  });

  server.decorate("authenticateAdmin", async () => {});
  server.decorate("authenticateAny", async (req: never, reply: never) => {
    return (
      server as never as {
        authenticate: (r: never, rep: never) => Promise<void>;
      }
    ).authenticate(req, reply);
  });

  const { dbRoutes } = await import("../../src/routes/db/index.js");
  await server.register(dbRoutes, { prefix: "/db" });
  await server.ready();

  adminToken = await jwtSvc.signAdminToken();
  readToken = await jwtSvc.signDbToken("project1", ["read"]);
  schemaToken = await jwtSvc.signDbToken("project1", ["schema"]);
});

afterAll(async () => {
  await server.close();
  vi.unstubAllEnvs();
});

beforeEach(() => {
  mockUnsafe.mockReset();
  mockUnsafe.mockResolvedValue([]);
  mockCacheDel.mockClear();
});

describe("GET /db/:database/extensions (E-76)", () => {
  it("schema token lists available + installed extensions", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/db/project1/extensions",
      headers: { Authorization: `Bearer ${schemaToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toEqual(
      expect.arrayContaining([
        {
          name: "plpgsql",
          installed_version: "1.0",
          default_version: "1.0",
          installed: true,
        },
        {
          name: "pg_trgm",
          installed_version: null,
          default_version: "1.6",
          installed: false,
        },
      ])
    );
  });

  it("admin token allowed", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/db/project1/extensions",
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(200);
  });

  it("read-only DB token denied", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/db/project1/extensions",
      headers: { Authorization: `Bearer ${readToken}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it("no token → 401", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/db/project1/extensions",
    });
    expect(res.statusCode).toBe(401);
  });
});

describe("POST /db/:database/extensions (E-77)", () => {
  it("schema token enables extension → 201", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/db/project1/extensions",
      headers: { Authorization: `Bearer ${schemaToken}` },
      payload: { name: "pg_trgm" },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({
      name: "pg_trgm",
      created: true,
      installed_version: "1.6",
      default_version: "1.6",
      installed: true,
    });
    expect(mockUnsafe).toHaveBeenCalledWith(
      'CREATE EXTENSION IF NOT EXISTS "pg_trgm"'
    );
    expect(mockCacheDel).toHaveBeenCalledWith("postgrify:project1:extensions");
  });

  it("allows hyphenated names (uuid-ossp)", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/db/project1/extensions",
      headers: { Authorization: `Bearer ${schemaToken}` },
      payload: { name: "uuid-ossp" },
    });
    expect(res.statusCode).toBe(201);
    expect(mockUnsafe).toHaveBeenCalledWith(
      'CREATE EXTENSION IF NOT EXISTS "uuid-ossp"'
    );
  });

  it("admin token allowed", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/db/project1/extensions",
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: { name: "pg_trgm" },
    });
    expect(res.statusCode).toBe(201);
  });

  it("unavailable extension → 404", async () => {
    mockUnsafe.mockRejectedValueOnce(
      new Error('extension "nope" is not available')
    );
    const res = await server.inject({
      method: "POST",
      url: "/db/project1/extensions",
      headers: { Authorization: `Bearer ${schemaToken}` },
      payload: { name: "nope" },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({
      error: "Extension not available on this server",
      name: "nope",
    });
  });

  it("invalid name → 400", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/db/project1/extensions",
      headers: { Authorization: `Bearer ${schemaToken}` },
      payload: { name: "evil;drop" },
    });
    expect(res.statusCode).toBe(400);
    expect(mockUnsafe).not.toHaveBeenCalled();
  });

  it("read-only DB token denied", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/db/project1/extensions",
      headers: { Authorization: `Bearer ${readToken}` },
      payload: { name: "pg_trgm" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("no token → 401", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/db/project1/extensions",
      payload: { name: "pg_trgm" },
    });
    expect(res.statusCode).toBe(401);
  });
});
