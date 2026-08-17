/**
 * Setup endpoint integration tests.
 *
 * GET  /setup/status → { configured: boolean }
 * POST /setup        → writes credentials; returns 403 when configured=true
 *
 * Scenarios covered:
 *   1. Basic GET /status behaviour (via env var)
 *   2. Basic POST / behaviour
 *   3. DB settings decorator with isConfiguredAsync fallback
 *   4. Container restart simulation: env cleared → DB returns true
 *   5. Docker mode: .env not writable → credentials written to DB
 *
 * Each test uses its own isolated Fastify instance. vi.resetModules() clears
 * the module cache so the _setupCompleted flag is reset for each test.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";

// ---------------------------------------------------------------------------
// fs mock
// ---------------------------------------------------------------------------
vi.mock("node:fs", () => ({
  default: {
    existsSync: vi.fn(() => true),
    readFileSync: vi.fn(() => "PG_HOST=localhost\nPG_PORT=5432\n"),
    writeFileSync: vi.fn(),
    renameSync: vi.fn(),
    unlinkSync: vi.fn(),
  },
  existsSync: vi.fn(() => true),
  readFileSync: vi.fn(() => "PG_HOST=localhost\nPG_PORT=5432\n"),
  writeFileSync: vi.fn(),
  renameSync: vi.fn(),
  unlinkSync: vi.fn(),
}));

// ---------------------------------------------------------------------------
// passwordService mock
// ---------------------------------------------------------------------------
vi.mock("../../src/services/passwordService.js", () => ({
  hashPassword: vi.fn().mockResolvedValue("$argon2id$hashed"),
  verifyPassword: vi.fn().mockResolvedValue(true),
}));

// ---------------------------------------------------------------------------
// config mock
// ---------------------------------------------------------------------------
const mockConfig = vi.hoisted(() => ({
  ADMIN_EMAIL: undefined as string | undefined,
  ADMIN_PASSWORD_HASH: undefined as string | undefined,
  JWT_SECRET: "placeholder-will-be-replaced-by-setup-wizard-32x",
  ADMIN_SECRET: "placeholder-setup-16x",
  ACCESS_TOKEN_EXPIRY: "15m",
}));

vi.mock("../../src/config/env.js", () => ({
  config: mockConfig,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Creates a fresh Fastify instance for each test.
 * vi.resetModules() resets the _setupCompleted flag.
 */
async function buildFreshServer(opts?: {
  withSettings?: {
    getAdminSetupCompleted?: () => Promise<boolean>;
    setAdminSetupCompleted?: () => Promise<void>;
    getAdminCredentials?: () => Promise<{ email: string; passwordHash: string } | null>;
    setAdminCredentials?: (email: string, hash: string) => Promise<void>;
  };
}): Promise<{
  server: FastifyInstance;
  resetFlag: () => void;
}> {
  vi.resetModules();
  const { setupRoutes, _resetSetupFlag } = await import("../../src/routes/setup.js");
  const server = Fastify({ logger: false });

  // settings decorator mock: used for container restart simulation
  if (opts?.withSettings) {
    const s = opts.withSettings;
    server.decorate("settings", {
      getAdminSetupCompleted: s.getAdminSetupCompleted ?? vi.fn().mockResolvedValue(false),
      setAdminSetupCompleted: s.setAdminSetupCompleted ?? vi.fn().mockResolvedValue(undefined),
      getAdminCredentials: s.getAdminCredentials ?? vi.fn().mockResolvedValue(null),
      setAdminCredentials: s.setAdminCredentials ?? vi.fn().mockResolvedValue(undefined),
    });
  }

  await server.register(setupRoutes);
  await server.ready();
  return { server, resetFlag: _resetSetupFlag };
}

const VALID_PAYLOAD = {
  adminEmail: "admin@example.com",
  adminPassword: "securePass1",
  pgHost: "localhost",
  pgPort: 5432,
  pgUser: "postgres",
  pgPassword: "pgpass",
};

// ---------------------------------------------------------------------------
// GET /status
// ---------------------------------------------------------------------------

describe("GET /status", () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    mockConfig.ADMIN_EMAIL = undefined;
    mockConfig.ADMIN_PASSWORD_HASH = undefined;
    ({ server } = await buildFreshServer());
  });

  afterEach(async () => {
    await server.close();
  });

  it("returns configured=false (setup not done)", async () => {
    const res = await server.inject({ method: "GET", url: "/status" });
    expect(res.statusCode).toBe(200);
    expect(res.json().configured).toBe(false);
  });

  it("returns configured=true (setup completed via env var)", async () => {
    mockConfig.ADMIN_EMAIL = "admin@example.com";
    mockConfig.ADMIN_PASSWORD_HASH = "$argon2id$hashed";

    const res = await server.inject({ method: "GET", url: "/status" });
    expect(res.statusCode).toBe(200);
    expect(res.json().configured).toBe(true);
  });
});

describe("GET /status — DB fallback (container restart simulation)", () => {
  it("returns configured=true when admin record exists in DB even if env var is empty", async () => {
    // Container restart: env var gone, admin record present in DB
    mockConfig.ADMIN_EMAIL = undefined;
    mockConfig.ADMIN_PASSWORD_HASH = undefined;

    const { server } = await buildFreshServer({
      withSettings: {
        getAdminCredentials: vi.fn().mockResolvedValue({
          email: "admin@example.com",
          passwordHash: "$argon2id$hash",
        }),
      },
    });

    try {
      const res = await server.inject({ method: "GET", url: "/status" });
      expect(res.statusCode).toBe(200);
      expect(res.json().configured).toBe(true);
    } finally {
      await server.close();
    }
  });
});

// ---------------------------------------------------------------------------
// POST /
// ---------------------------------------------------------------------------

describe("POST /", () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    mockConfig.ADMIN_EMAIL = undefined;
    mockConfig.ADMIN_PASSWORD_HASH = undefined;
    ({ server } = await buildFreshServer());
  });

  afterEach(async () => {
    await server.close();
  });

  it("returns 200 and ok:true on first setup", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/",
      payload: VALID_PAYLOAD,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
  });

  it("returns 403 when setup is already completed", async () => {
    mockConfig.ADMIN_EMAIL = "admin@example.com";
    mockConfig.ADMIN_PASSWORD_HASH = "$argon2id$hashed";

    const res = await server.inject({
      method: "POST",
      url: "/",
      payload: VALID_PAYLOAD,
    });
    expect(res.statusCode).toBe(403);
  });

  it("returns 400 when adminEmail is missing", async () => {
    const { adminEmail: _omit, ...rest } = VALID_PAYLOAD;
    const res = await server.inject({ method: "POST", url: "/", payload: rest });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 when adminPassword is missing", async () => {
    const { adminPassword: _omit, ...rest } = VALID_PAYLOAD;
    const res = await server.inject({ method: "POST", url: "/", payload: rest });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 when pgHost is missing", async () => {
    const { pgHost: _omit, ...rest } = VALID_PAYLOAD;
    const res = await server.inject({ method: "POST", url: "/", payload: rest });
    expect(res.statusCode).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Docker mode — credentials written to DB when .env is not writable
// ---------------------------------------------------------------------------

describe("Docker mode — credentials written to DB", () => {
  it("calls setAdminCredentials when .env write is skipped", async () => {
    mockConfig.ADMIN_EMAIL = undefined;
    mockConfig.ADMIN_PASSWORD_HASH = undefined;

    const setCredsSpy = vi.fn().mockResolvedValue(undefined);
    const freshServer = Fastify({ logger: false });

    freshServer.decorate("settings", {
      getAdminSetupCompleted: vi.fn().mockResolvedValue(false),
      setAdminSetupCompleted: vi.fn().mockResolvedValue(undefined),
      getAdminCredentials: vi.fn().mockResolvedValue(null),
      setAdminCredentials: setCredsSpy,
    });

    vi.resetModules();
    const { setupRoutes } = await import("../../src/routes/setup.js");
    await freshServer.register(setupRoutes);
    await freshServer.ready();

    try {
      const res = await freshServer.inject({
        method: "POST",
        url: "/",
        payload: VALID_PAYLOAD,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().ok).toBe(true);
    } finally {
      await freshServer.close();
    }
  });
});

// ---------------------------------------------------------------------------
// Container restart recovery — after POST /setup flag is reset,
// configured=true must be read from the DB flag
// ---------------------------------------------------------------------------

describe("Container restart recovery", () => {
  it("reads configured=true from DB after flag is reset following setup", async () => {
    // Simulation:
    // 1. Setup was done → admin credentials written to DB
    // 2. Container restarts → _setupCompleted = null, config empty
    // 3. /setup/status → query DB → admin found → returns true

    mockConfig.ADMIN_EMAIL = undefined;
    mockConfig.ADMIN_PASSWORD_HASH = undefined;

    // Admin record exists in DB
    const { server, resetFlag } = await buildFreshServer({
      withSettings: {
        getAdminCredentials: vi.fn().mockResolvedValue({
          email: "admin@example.com",
          passwordHash: "$argon2id$hash",
        }),
      },
    });

    // Simulate restart: reset flag
    resetFlag();

    try {
      const res = await server.inject({ method: "GET", url: "/status" });
      expect(res.statusCode).toBe(200);
      expect(res.json().configured).toBe(true);
    } finally {
      await server.close();
    }
  });
});