/**
 * Test: Issue #1 Fix — FK (references) support for POST /tables.
 *
 * The `references` field was added to the column definition in the tables.ts POST handler.
 * This test verifies that creating a table with an FK produces the correct DDL.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { JwtService } from "../../src/services/jwtService.js";

const JWT_SECRET = "test-secret-must-be-at-least-32-characters-long";

vi.stubEnv("JWT_SECRET", JWT_SECRET);
vi.stubEnv("ADMIN_SECRET", "test-admin-secret-16ch");

// Capture DDL statements
const capturedDDL: string[] = [];

vi.mock("postgres", () => {
  const sqlMock = vi.fn(() => {
    const fn = vi.fn().mockResolvedValue([]) as unknown as Record<string, unknown>;
    fn.unsafe = vi.fn().mockImplementation((ddl: string) => {
      capturedDDL.push(ddl);
      return Promise.resolve([]);
    });
    fn.end = vi.fn().mockResolvedValue(undefined);
    fn.begin = vi.fn().mockImplementation((_: string, cb: (tx: unknown) => unknown) => cb(fn));
    return fn;
  });
  return { default: sqlMock };
});

vi.mock("../../src/services/cacheService.js", () => ({
  CacheService: vi.fn().mockImplementation(() => ({
    connect: vi.fn(),
    disconnect: vi.fn(),
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn(),
    del: vi.fn(),
    invalidatePattern: vi.fn(),
    buildKey: (...p: string[]) => p.join(":"),
  })),
  TTL: { ROW_QUERY: 30, SCHEMA: 300, TABLE_LIST: 120, DB_SIZE: 60 },
}));

let server: FastifyInstance;
let jwtSvc: JwtService;
let schemaToken: string;

beforeAll(async () => {
  server = Fastify({ logger: false });

  const { PoolManager } = await import("../../src/services/poolManager.js");
  const { CacheService } = await import("../../src/services/cacheService.js");

  server.decorate("poolManager", new PoolManager({} as never));
  server.decorate("cache", new CacheService());
  server.decorateRequest("user", null);
  server.decorateRequest("dbName", "testdb");
  server.decorateRequest("dbUser", null);

  jwtSvc = new JwtService(JWT_SECRET);
  schemaToken = await jwtSvc.signDbToken("testdb", ["schema"]);

  server.decorate("authenticate", async (req: Parameters<typeof server.authenticate>[0], reply: Parameters<typeof server.authenticate>[1]) => {
    const auth = req.headers.authorization;
    if (!auth?.startsWith("Bearer ")) return reply.status(401).send({ error: "Unauthorized" });
    const payload = await jwtSvc.verifyAdminOrDb(auth.slice(7));
    if (!payload) return reply.status(401).send({ error: "Invalid token" });
    req.user = payload;
  });

  server.decorate("authenticateAdmin", async () => {});

  server.decorate("authenticateAny", async (req: Parameters<typeof server.authenticateAny>[0], reply: Parameters<typeof server.authenticateAny>[1]) => {
    const auth = req.headers.authorization;
    if (!auth?.startsWith("Bearer ")) return reply.status(401).send({ error: "Unauthorized" });
    const token = auth.slice(7);
    const adminOrDb = await jwtSvc.verifyAdminOrDb(token);
    if (adminOrDb) { req.user = adminOrDb; return; }
    const dbUser = await jwtSvc.verifyDbUser(token);
    if (dbUser) { req.dbUser = dbUser; return; }
    return reply.status(401).send({ error: "Invalid token" });
  });

  server.addHook("preHandler", async (req) => { req.dbName = "testdb"; });

  const { dbRoutes } = await import("../../src/routes/db/index.js");
  await server.register(dbRoutes);
  await server.ready();
});

afterAll(() => server.close());

describe("Issue #1 — POST /tables FK support", () => {
  it("creating a table without an FK should continue to work", async () => {
    capturedDDL.length = 0;

    const res = await server.inject({
      method: "POST",
      url: "/testdb/tables",
      headers: { authorization: `Bearer ${schemaToken}`, "content-type": "application/json" },
      payload: {
        name: "simple_table",
        columns: [
          { name: "id",   type: "uuid",   primaryKey: true, default: "gen_random_uuid()" },
          { name: "name", type: "text",   nullable: false },
        ],
      },
    });

    expect(res.statusCode, `Table creation error: ${res.body}`).toBe(201);
    expect(capturedDDL.some(d => d.includes("CREATE TABLE"))).toBe(true);
    expect(capturedDDL.some(d => d.includes("FOREIGN KEY"))).toBe(false);
  });

  it("creating a table with references should produce a FOREIGN KEY in the DDL", async () => {
    capturedDDL.length = 0;

    const res = await server.inject({
      method: "POST",
      url: "/testdb/tables",
      headers: { authorization: `Bearer ${schemaToken}`, "content-type": "application/json" },
      payload: {
        name: "tweets",
        columns: [
          { name: "id",      type: "uuid", primaryKey: true, default: "gen_random_uuid()" },
          { name: "user_id", type: "uuid", nullable: false, references: { table: "users", column: "id", onDelete: "CASCADE" } },
          { name: "content", type: "text", nullable: false },
        ],
      },
    });

    expect(res.statusCode, `FK table creation error: ${res.body}`).toBe(201);

    const ddl = capturedDDL.find(d => d.includes("CREATE TABLE"));
    expect(ddl, "DDL was not captured").toBeDefined();
    expect(ddl).toContain("FOREIGN KEY");
    expect(ddl).toContain('"users"');
    expect(ddl).toContain("ON DELETE CASCADE");
  });

  it("DEFAULT onDelete NO ACTION should be applied", async () => {
    capturedDDL.length = 0;

    const res = await server.inject({
      method: "POST",
      url: "/testdb/tables",
      headers: { authorization: `Bearer ${schemaToken}`, "content-type": "application/json" },
      payload: {
        name: "likes",
        columns: [
          { name: "user_id",  type: "uuid", nullable: false, references: { table: "users" } },
          { name: "tweet_id", type: "uuid", nullable: false, references: { table: "tweets" } },
        ],
      },
    });

    expect(res.statusCode, `likes table error: ${res.body}`).toBe(201);

    const ddl = capturedDDL.find(d => d.includes("CREATE TABLE"));
    expect(ddl).toContain("ON DELETE NO ACTION");
  });

  it("an invalid onDelete value should be rejected", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/testdb/tables",
      headers: { authorization: `Bearer ${schemaToken}`, "content-type": "application/json" },
      payload: {
        name: "bad_table",
        columns: [
          { name: "user_id", type: "uuid", references: { table: "users", onDelete: "DROP ALL" } },
        ],
      },
    });

    expect([400, 500]).toContain(res.statusCode);
  });

  it("an invalid referenced table name should fail the identifier check", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/testdb/tables",
      headers: { authorization: `Bearer ${schemaToken}`, "content-type": "application/json" },
      payload: {
        name: "attack_table",
        columns: [
          { name: "user_id", type: "uuid", references: { table: "users; DROP TABLE users--" } },
        ],
      },
    });

    expect([400, 500]).toContain(res.statusCode);
  });
});