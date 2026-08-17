/**
 * Rate limit plugin tests.
 * Verifies that 429 is returned when the limit is exceeded and checks the error message format.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import rateLimit from "@fastify/rate-limit";

vi.stubEnv("JWT_SECRET", "test-secret-must-be-at-least-32-characters");
vi.stubEnv("ADMIN_SECRET", "test-admin-secret-16ch");

let server: FastifyInstance;

beforeAll(async () => {
  server = Fastify({ logger: false });

  // max=2 — should return 429 on the 3rd request
  await server.register(rateLimit, {
    max: 2,
    timeWindow: "1 minute",
    keyGenerator: (req) =>
      (req.headers["x-forwarded-for"] as string) ?? req.ip ?? "test-ip",
    errorResponseBuilder: (_req, context) => {
      const retryAfter = Math.ceil(context.ttl / 1000);
      return {
        statusCode: 429,
        error: "Too many requests",
        message: `Rate limit exceeded. Try again in ${retryAfter} seconds.`,
        retryAfter,
      };
    },
  });

  server.get("/ping", async () => ({ ok: true }));
  await server.ready();
});

afterAll(async () => {
  await server.close();
  vi.unstubAllEnvs();
});

describe("Rate limit plugin", () => {
  it("returns 200 for requests within the limit", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/ping",
      headers: { "x-forwarded-for": "10.0.0.1" },
    });
    expect(res.statusCode).toBe(200);
  });

  it("returns 429 and includes an error message when the limit is exceeded", async () => {
    const headers = { "x-forwarded-for": "10.0.0.2" };

    const r1 = await server.inject({ method: "GET", url: "/ping", headers });
    const r2 = await server.inject({ method: "GET", url: "/ping", headers });
    const r3 = await server.inject({ method: "GET", url: "/ping", headers });

    expect(r1.statusCode).toBe(200);
    expect(r2.statusCode).toBe(200);
    expect(r3.statusCode).toBe(429);

    const body = r3.json();
    expect(body).toHaveProperty("error", "Too many requests");
    expect(body).toHaveProperty("retryAfter");
  });

  it("retryAfter in a 429 response is of type number", async () => {
    const headers = { "x-forwarded-for": "10.0.0.3" };

    await server.inject({ method: "GET", url: "/ping", headers });
    await server.inject({ method: "GET", url: "/ping", headers });
    const res = await server.inject({ method: "GET", url: "/ping", headers });

    expect(res.statusCode).toBe(429);
    expect(typeof res.json().retryAfter).toBe("number");
  });
});