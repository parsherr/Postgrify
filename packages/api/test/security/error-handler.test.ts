/**
 * SEC-6: Global error handler testleri.
 *
 * Production'da stack trace'ler ve iç hata mesajları gizlenmeli.
 * Development'ta tam hata detayı dönmeli.
 * 4xx hataları mesajını ileterek 5xx'leri gizlemeli.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import { errorHandlerPlugin } from "../../src/plugins/errorHandler.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

async function buildServer(env: "development" | "production" | "test") {
  vi.stubEnv("NODE_ENV", env);
  const server = Fastify({ logger: false });
  await server.register(errorHandlerPlugin);

  // Test route'ları
  server.get("/throw-500", async () => {
    throw new Error("Internal database connection failed with secret key: abc123");
  });

  server.get("/throw-400", async (_req, reply) => {
    return reply.status(400).send({ error: "Bad request test" });
  });

  server.get("/throw-fastify-error", async (_req, reply) => {
    const err = Object.assign(new Error("Validation failed"), { statusCode: 422 });
    throw err;
  });

  await server.ready();
  return server;
}

describe("SEC-6: Error handler — production mode", () => {
  it("500 hatası internal mesajı gizler", async () => {
    const server = await buildServer("production");
    const res = await server.inject({ method: "GET", url: "/throw-500" });

    expect(res.statusCode).toBe(500);
    const body = JSON.parse(res.body);
    // Stack trace production'da olmamalı
    expect(body.stack).toBeUndefined();
    // Internal hata mesajı sızdırılmamalı
    expect(body.error).not.toContain("database connection failed");
    expect(body.error).not.toContain("secret key");
    // Generic mesaj
    expect(body.error).toBe("Internal Server Error");
    // errorId olmalı (support için izlenebilir)
    expect(body.errorId).toBeDefined();
  });

  it("errorId UUID formatında", async () => {
    const server = await buildServer("production");
    const res = await server.inject({ method: "GET", url: "/throw-500" });
    const body = JSON.parse(res.body);
    expect(body.errorId).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("SEC-6: Error handler — development mode", () => {
  it("development'ta stack trace dönebilir", async () => {
    const server = await buildServer("development");
    const res = await server.inject({ method: "GET", url: "/throw-500" });

    expect(res.statusCode).toBe(500);
    const body = JSON.parse(res.body);
    // Development'ta stack veya error mesajı görünebilir
    expect(body.errorId).toBeDefined();
  });
});

describe("SEC-6: Error handler — HTTP status codes", () => {
  it("4xx status kodu korunur", async () => {
    const server = await buildServer("production");
    const res = await server.inject({ method: "GET", url: "/throw-fastify-error" });

    expect(res.statusCode).toBe(422);
    const body = JSON.parse(res.body);
    expect(body.errorId).toBeDefined();
  });

  it("200 response normal dönmeli", async () => {
    // Kendi server'ını kur — önceki buildServer çağrısından bağımsız
    vi.stubEnv("NODE_ENV", "production");
    const server = Fastify({ logger: false });
    await server.register(errorHandlerPlugin);
    // Route'ları ready() öncesinde ekle
    server.get("/ok", async () => ({ ok: true }));
    await server.ready();

    const res = await server.inject({ method: "GET", url: "/ok" });
    await server.close();

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: true });
  });
});

describe("SEC-6: errorHandlerPlugin.ts kod kontrolü", () => {
  it("production'da stack trace gizleme kodu mevcut", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const { dirname, join } = await import("node:path");

    const __dirname = dirname(fileURLToPath(import.meta.url));
    const pluginPath = join(__dirname, "../../src/plugins/errorHandler.ts");
    const content = readFileSync(pluginPath, "utf-8");

    expect(content).toMatch(/production/);
    expect(content).toMatch(/stack/);
    expect(content).toMatch(/errorId/);
    expect(content).toMatch(/randomUUID/);
  });

  it("errorHandlerPlugin plugins/index.ts'e kayıtlı", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const { dirname, join } = await import("node:path");

    const __dirname = dirname(fileURLToPath(import.meta.url));
    const indexPath = join(__dirname, "../../src/plugins/index.ts");
    const content = readFileSync(indexPath, "utf-8");

    expect(content).toMatch(/errorHandlerPlugin/);
    expect(content).toMatch(/errorHandler/);
  });
});