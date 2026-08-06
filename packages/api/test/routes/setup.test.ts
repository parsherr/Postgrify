/**
 * Setup endpoint integration testleri.
 *
 * GET  /setup/status → configured durumunu döner
 * POST /setup        → .env'e yazar, configured=true iken 403 döner
 *
 * fs.readFileSync / fs.writeFileSync mock'lanır — gerçek dosya yazılmaz.
 */

import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";

// ── fs mock ──────────────────────────────────────────────────────────────────
vi.mock("node:fs", () => ({
  default: {
    existsSync: vi.fn(() => true),
    readFileSync: vi.fn(() => "PG_HOST=localhost\nPG_PORT=5432\n"),
    writeFileSync: vi.fn(),
  },
  existsSync: vi.fn(() => true),
  readFileSync: vi.fn(() => "PG_HOST=localhost\nPG_PORT=5432\n"),
  writeFileSync: vi.fn(),
}));

// ── config mock — setup tamamlanmamış durum (default) ────────────────────────
const mockConfig = {
  ADMIN_EMAIL: undefined as string | undefined,
  ADMIN_PASSWORD_HASH: undefined as string | undefined,
  JWT_SECRET: "placeholder-will-be-replaced-by-setup-wizard-32x",
  ADMIN_SECRET: "placeholder-setup-16x",
};

vi.mock("../../src/config/env.js", () => ({
  config: mockConfig,
}));

// ── passwordService mock ──────────────────────────────────────────────────────
vi.mock("../../src/services/passwordService.js", () => ({
  hashPassword: vi.fn().mockResolvedValue("$argon2id$hashed"),
  verifyPassword: vi.fn().mockResolvedValue(true),
}));

let server: FastifyInstance;

async function buildServer() {
  const s = Fastify({ logger: false });
  const { setupRoutes } = await import("../../src/routes/setup.js");
  await s.register(setupRoutes);
  await s.ready();
  return s;
}

beforeAll(async () => {
  server = await buildServer();
});

afterAll(async () => {
  await server.close();
});

beforeEach(() => {
  // Her testten önce configured=false'a sıfırla
  mockConfig.ADMIN_EMAIL = undefined;
  mockConfig.ADMIN_PASSWORD_HASH = undefined;
});

// ─────────────────────────────────────────────────────────────────────────────

describe("GET /status", () => {
  it("configured=false döner (kurulum yapılmamış)", async () => {
    mockConfig.ADMIN_EMAIL = undefined;
    mockConfig.ADMIN_PASSWORD_HASH = undefined;

    const res = await server.inject({ method: "GET", url: "/status" });
    expect(res.statusCode).toBe(200);
    expect(res.json().configured).toBe(false);
  });

  it("configured=true döner (kurulum tamamlanmış)", async () => {
    mockConfig.ADMIN_EMAIL = "admin@example.com";
    mockConfig.ADMIN_PASSWORD_HASH = "$argon2id$hashed";

    const res = await server.inject({ method: "GET", url: "/status" });
    expect(res.statusCode).toBe(200);
    expect(res.json().configured).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("POST /", () => {
  const validPayload = {
    adminEmail: "admin@example.com",
    adminPassword: "securePass1",
    pgHost: "localhost",
    pgPort: 5432,
    pgUser: "postgres",
    pgPassword: "pgpass",
  };

  it("200 ve ok:true döner (kurulum tamamlanmamışken)", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/",
      payload: validPayload,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(typeof body.message).toBe("string");
  });

  it("fs.writeFileSync çağrılır", async () => {
    const fsModule = await import("node:fs");
    // setup.ts default import kullandığı için default üzerinden spy
    const writeSpy = vi.spyOn(fsModule.default, "writeFileSync");

    await server.inject({
      method: "POST",
      url: "/",
      payload: validPayload,
    });

    expect(writeSpy).toHaveBeenCalled();
    const writtenContent = writeSpy.mock.calls[0]?.[1] as string;
    expect(writtenContent).toContain("ADMIN_EMAIL=admin@example.com");
    expect(writtenContent).toContain("ADMIN_PASSWORD_HASH=");
    expect(writtenContent).toContain("PG_HOST=localhost");
    expect(writtenContent).toContain("PG_USER=postgres");
  });

  it("configured=true iken 403 döner", async () => {
    mockConfig.ADMIN_EMAIL = "existing@example.com";
    mockConfig.ADMIN_PASSWORD_HASH = "$argon2id$existing";

    const res = await server.inject({
      method: "POST",
      url: "/",
      payload: validPayload,
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toMatch(/already completed/i);
  });

  it("eksik alan → 400 döner", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/",
      payload: { adminEmail: "x@y.com" }, // eksik alanlar
    });
    expect(res.statusCode).toBe(400);
  });

  it("geçersiz email → 400 döner", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/",
      payload: { ...validPayload, adminEmail: "not-an-email" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("8 karakterden kısa şifre → 400 döner", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/",
      payload: { ...validPayload, adminPassword: "short" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("geçersiz port → 400 döner", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/",
      payload: { ...validPayload, pgPort: 99999 },
    });
    expect(res.statusCode).toBe(400);
  });
});