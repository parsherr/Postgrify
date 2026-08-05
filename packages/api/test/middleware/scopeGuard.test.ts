/**
 * ScopeGuard middleware testleri.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { scopeGuard } from "../../src/middleware/scopeGuard.js";
import type { JwtPayload } from "../../src/types/auth.js";

function buildServer(userOverride?: Partial<JwtPayload> | null) {
  const s = Fastify({ logger: false });
  s.decorateRequest("user", null);
  s.decorateRequest("dbName", null);

  // Her request'te user ve dbName'i set et
  s.addHook("preHandler", async (req) => {
    req.dbName = "project1";
    req.user = userOverride !== undefined
      ? (userOverride as JwtPayload)
      : { role: "db", sub: "project1", scope: ["read", "write"] } as JwtPayload;
  });

  s.get("/test", { preHandler: [scopeGuard("read")] }, async () => ({ ok: true }));
  s.get("/write", { preHandler: [scopeGuard("write")] }, async () => ({ ok: true }));
  s.get("/delete", { preHandler: [scopeGuard("delete")] }, async () => ({ ok: true }));
  return s;
}

describe("scopeGuard", () => {
  it("doğru scope ile geçer", async () => {
    const s = buildServer();
    await s.ready();
    const res = await s.inject({ method: "GET", url: "/test" });
    expect(res.statusCode).toBe(200);
    await s.close();
  });

  it("admin token tüm scope'ları geçer", async () => {
    const s = buildServer({ role: "admin" } as JwtPayload);
    await s.ready();
    const res = await s.inject({ method: "GET", url: "/delete" });
    expect(res.statusCode).toBe(200);
    await s.close();
  });

  it("eksik scope ile 403 döner", async () => {
    const s = buildServer({
      role: "db",
      sub: "project1",
      scope: ["read"],
    } as JwtPayload);
    await s.ready();
    const res = await s.inject({ method: "GET", url: "/delete" });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toMatch(/Insufficient permissions/);
    await s.close();
  });

  it("farklı DB'ye ait token 403 döner", async () => {
    const s = buildServer({
      role: "db",
      sub: "project2",  // project1 için değil
      scope: ["read", "write"],
    } as JwtPayload);
    await s.ready();
    const res = await s.inject({ method: "GET", url: "/test" });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toMatch(/Access denied/);
    await s.close();
  });

  it("user null ise 401 döner", async () => {
    const s = buildServer(null);
    await s.ready();
    const res = await s.inject({ method: "GET", url: "/test" });
    expect(res.statusCode).toBe(401);
    await s.close();
  });
});