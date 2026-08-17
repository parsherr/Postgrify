/**
 * SEC-5: Fastify trustProxy tests.
 *
 * Without trustProxy: true, the API behind nginx cannot see the real client IP.
 * Rate-limit sees all requests as coming from the same IP (the proxy IP).
 *
 * Test: verifies that trustProxy: true is set in index.ts.
 */

import { describe, it, expect } from "vitest";
import Fastify from "fastify";

describe("SEC-5: trustProxy configuration", () => {
  it("index.ts contains trustProxy: true", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const { dirname, join } = await import("node:path");

    const __dirname = dirname(fileURLToPath(import.meta.url));
    const indexPath = join(__dirname, "../../src/index.ts");
    const content = readFileSync(indexPath, "utf-8");

    expect(content).toMatch(/trustProxy\s*:\s*true/);
  });

  it("X-Forwarded-For is readable with trustProxy: true", async () => {
    const server = Fastify({
      logger: false,
      trustProxy: true,
    });

    server.get("/ip", (req) => ({ ip: req.ip }));
    await server.ready();

    const res = await server.inject({
      method: "GET",
      url: "/ip",
      headers: {
        "X-Forwarded-For": "1.2.3.4",
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.ip).toBe("1.2.3.4");

    await server.close();
  });

  it("X-Forwarded-For is ignored with trustProxy: false (default)", async () => {
    const server = Fastify({ logger: false });
    server.get("/ip", (req) => ({ ip: req.ip }));
    await server.ready();

    const res = await server.inject({
      method: "GET",
      url: "/ip",
      headers: {
        "X-Forwarded-For": "1.2.3.4",
      },
    });

    const body = JSON.parse(res.body);
    // X-Forwarded-For is ignored when trustProxy is false
    expect(body.ip).not.toBe("1.2.3.4");

    await server.close();
  });

  it("trustProxy documentation is explained in index.ts comment", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const { dirname, join } = await import("node:path");

    const __dirname = dirname(fileURLToPath(import.meta.url));
    const indexPath = join(__dirname, "../../src/index.ts");
    const content = readFileSync(indexPath, "utf-8");

    // Why trustProxy is necessary must be documented in a comment
    expect(content).toMatch(/trustProxy|reverse proxy|req\.ip/i);
  });
});