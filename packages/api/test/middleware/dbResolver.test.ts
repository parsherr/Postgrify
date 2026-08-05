/**
 * DB Resolver middleware testleri.
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

  // Test route: resolver'ı çalıştır, dbName'i döndür
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
  it("URL parametresinden DB adını okur", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/db/project1/test",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().dbName).toBe("project1");
  });

  it("X-Database header'ından okur", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/header-test",
      headers: { "x-database": "project2" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().dbName).toBe("project2");
  });

  it("query parametresinden okur", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/query-test?database=project3",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().dbName).toBe("project3");
  });

  it("DB belirtilmezse 400 döner", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/header-test",
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/Database not specified/);
  });

  it("geçersiz DB adı 400 döner", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/header-test",
      headers: { "x-database": "123-invalid!" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/Invalid database name/);
  });

  it("URL parametresi header'a göre önceliklidir", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/db/url_wins/test",
      headers: { "x-database": "header_loses" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().dbName).toBe("url_wins");
  });
});