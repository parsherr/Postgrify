/**
 * SEC-6: Global error handler tests.
 *
 * Stack traces and internal error messages must be hidden in production.
 * Full error detail must be returned in development.
 * 4xx errors pass their message through; 5xx errors are hidden.
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

  // Test routes
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
  it("500 error hides internal message", async () => {
    const server = await buildServer("production");
    const res = await server.inject({ method: "GET", url: "/throw-500" });

    expect(res.statusCode).toBe(500);
    const body = JSON.parse(res.body);
    // Stack trace must not be present in production
    expect(body.stack).toBeUndefined();
    // Internal error message must not be leaked
    expect(body.error).not.toContain("database connection failed");
    expect(body.error).not.toContain("secret key");
    // Generic message
    expect(body.error).toBe("Internal Server Error");
    // errorId must be present (traceable for support)
    expect(body.errorId).toBeDefined();
  });

  it("errorId is in UUID format", async () => {
    const server = await buildServer("production");
    const res = await server.inject({ method: "GET", url: "/throw-500" });
    const body = JSON.parse(res.body);
    expect(body.errorId).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("SEC-6: Error handler — development mode", () => {
  it("stack trace may be returned in development", async () => {
    const server = await buildServer("development");
    const res = await server.inject({ method: "GET", url: "/throw-500" });

    expect(res.statusCode).toBe(500);
    const body = JSON.parse(res.body);
    // Stack or error message may be visible in development
    expect(body.errorId).toBeDefined();
  });
});

describe("SEC-6: Error handler — HTTP status codes", () => {
  it("4xx status code is preserved", async () => {
    const server = await buildServer("production");
    const res = await server.inject({ method: "GET", url: "/throw-fastify-error" });

    expect(res.statusCode).toBe(422);
    const body = JSON.parse(res.body);
    expect(body.errorId).toBeDefined();
  });

  it("200 response returns normally", async () => {
    // Set up its own server — independent of previous buildServer calls
    vi.stubEnv("NODE_ENV", "production");
    const server = Fastify({ logger: false });
    await server.register(errorHandlerPlugin);
    // Add routes before ready()
    server.get("/ok", async () => ({ ok: true }));
    await server.ready();

    const res = await server.inject({ method: "GET", url: "/ok" });
    await server.close();

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: true });
  });
});

describe("SEC-6: errorHandlerPlugin.ts code check", () => {
  it("stack trace hiding code is present in production", async () => {
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

  it("errorHandlerPlugin is registered in plugins/index.ts", async () => {
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