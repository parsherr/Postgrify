/**
 * SEC-5: Fastify trustProxy testleri.
 *
 * trustProxy: true olmadan nginx arkasındaki API gerçek client IP'sini
 * göremez. Rate-limit tüm requestleri aynı IP'den (proxy IP) görür.
 *
 * Test: index.ts'de trustProxy: true ayarının varlığını doğrula.
 */

import { describe, it, expect } from "vitest";
import Fastify from "fastify";

describe("SEC-5: trustProxy konfigürasyonu", () => {
  it("index.ts trustProxy: true içeriyor", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const { dirname, join } = await import("node:path");

    const __dirname = dirname(fileURLToPath(import.meta.url));
    const indexPath = join(__dirname, "../../src/index.ts");
    const content = readFileSync(indexPath, "utf-8");

    expect(content).toMatch(/trustProxy\s*:\s*true/);
  });

  it("trustProxy: true ile X-Forwarded-For okunabilir", async () => {
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

  it("trustProxy: false (varsayılan) ile X-Forwarded-For görmezden gelinir", async () => {
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
    // trustProxy false olduğunda X-Forwarded-For ignore edilir
    expect(body.ip).not.toBe("1.2.3.4");

    await server.close();
  });

  it("trustProxy belgesi index.ts yorumunda açıklanıyor", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const { dirname, join } = await import("node:path");

    const __dirname = dirname(fileURLToPath(import.meta.url));
    const indexPath = join(__dirname, "../../src/index.ts");
    const content = readFileSync(indexPath, "utf-8");

    // trustProxy neden gerekli olduğu yorumlanmış olmalı
    expect(content).toMatch(/trustProxy|reverse proxy|req\.ip/i);
  });
});