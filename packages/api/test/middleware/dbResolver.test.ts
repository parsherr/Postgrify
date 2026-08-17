/**
 * DB Resolver middleware tests.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { dbResolverHook } from "../../src/middleware/dbResolver.js";

let server: FastifyInstance;

beforeAll(async () => {
  server = Fastify({ logger: false });
  server.decorateRequest("dbName", null);
  server.decorateRequest("user", null);

  // Test route: run the resolver and return dbName
  server.get(
    "/db/:database/test",
    { preHandler: [dbResolverHook] },
    async (req) => ({ dbName: req.dbName })
  );
  server.get(
    "/header-test",
    { preHandler: [dbResolverHook] },
    async (req) => ({ dbName: req.dbName })
  );
  server.get(
    "/query-test",
    { preHandler: [dbResolverHook] },
    async (req) => ({ dbName: req.dbName })
  );

  await server.ready();
});

afterAll(async () => {
  await server.close();
});

describe("dbResolverHook", () => {
  it("reads the DB name from the URL parameter", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/db/project1/test",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().dbName).toBe("project1");
  });

  it("reads from the X-Database header", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/header-test",
      headers: { "x-database": "project2" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().dbName).toBe("project2");
  });

  it("reads from the query parameter", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/query-test?database=project3",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().dbName).toBe("project3");
  });

  it("returns 400 when no DB is specified", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/header-test",
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/Database not specified/);
  });

  it("returns 400 for an invalid DB name", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/header-test",
      headers: { "x-database": "123-invalid!" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/Invalid database name/);
  });

  it("URL parameter takes priority over header", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/db/url_wins/test",
      headers: { "x-database": "header_loses" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().dbName).toBe("url_wins");
  });
});