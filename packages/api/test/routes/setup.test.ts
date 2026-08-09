/**
 * Setup endpoint integration testleri.
 *
 * GET  /setup/status → { configured: boolean }
 * POST /setup        → credentials yazar, configured=true iken 403 döner
 *
 * Test edilenler:
 *   1. Temel GET /status davranışı (env var ile)
 *   2. Temel POST / davranışı
 *   3. DB settings decorator ile isConfiguredAsync fallback
 *   4. Container restart simülasyonu: env temizle → DB'den true döner
 *   5. Docker mod: .env yazılamıyor → DB'ye credentials yazıldı
 *
 * Her test kendi izole Fastify örneği kullanır. vi.resetModules() ile
 * modül önbelleği temizlenir → _setupCompleted flag'i her test için sıfırlanır.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";

// ── fs mock ──────────────────────────────────────────────────────────────────
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

// ── passwordService mock ──────────────────────────────────────────────────────
vi.mock("../../src/services/passwordService.js", () => ({
  hashPassword: vi.fn().mockResolvedValue("$argon2id$hashed"),
  verifyPassword: vi.fn().mockResolvedValue(true),
}));

// ── config mock ───────────────────────────────────────────────────────────────
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

// ─────────────────────────────────────────────────────────────────────────────
// Yardımcılar
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Her test için temiz bir Fastify instance'ı oluşturur.
 * vi.resetModules() ile _setupCompleted flag'i sıfırlanır.
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

  // settings decorator mock'u: container restart simülasyonu için
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

// ─────────────────────────────────────────────────────────────────────────────
// GET /status
// ─────────────────────────────────────────────────────────────────────────────

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

  it("configured=false döner (kurulum yapılmamış)", async () => {
    const res = await server.inject({ method: "GET", url: "/status" });
    expect(res.statusCode).toBe(200);
    expect(res.json().configured).toBe(false);
  });

  it("configured=true döner (env var ile kurulum tamamlanmış)", async () => {
    mockConfig.ADMIN_EMAIL = "admin@example.com";
    mockConfig.ADMIN_PASSWORD_HASH = "$argon2id$hashed";

    const res = await server.inject({ method: "GET", url: "/status" });
    expect(res.statusCode).toBe(200);
    expect(res.json().configured).toBe(true);
  });
});

describe("GET /status — DB fallback (container restart simülasyonu)", () => {
  it("env var boş olsa da DB'de admin kaydı varsa configured=true döner", async () => {
    // Container restart: env var kaybolmuş, DB'de admin var
    mockConfig.ADMIN_EMAIL = undefined;
    mockConfig.ADMIN_PASSWORD_HASH = undefined;

    const { server } = await buildFreshServer({
      withSettings: {
        getAdminCredentials: vi.fn().mockResolvedValue({
          email: "admin@example.com",
          passwordHash: "$argon2id$hashed",
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

  it("env var boş ve DB'de admin yoksa configured=false döner", async () => {
    mockConfig.ADMIN_EMAIL = undefined;
    mockConfig.ADMIN_PASSWORD_HASH = undefined;

    const { server } = await buildFreshServer({
      withSettings: {
        getAdminCredentials: vi.fn().mockResolvedValue(null),
      },
    });

    try {
      const res = await server.inject({ method: "GET", url: "/status" });
      expect(res.statusCode).toBe(200);
      expect(res.json().configured).toBe(false);
    } finally {
      await server.close();
    }
  });

  it("DB sorgusu başarısız olursa configured=false döner (graceful fallback)", async () => {
    mockConfig.ADMIN_EMAIL = undefined;
    mockConfig.ADMIN_PASSWORD_HASH = undefined;

    const { server } = await buildFreshServer({
      withSettings: {
        getAdminCredentials: vi.fn().mockRejectedValue(new Error("DB connection failed")),
      },
    });

    try {
      const res = await server.inject({ method: "GET", url: "/status" });
      expect(res.statusCode).toBe(200);
      expect(res.json().configured).toBe(false);
    } finally {
      await server.close();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /", () => {
  let server: FastifyInstance;
  let setAdminCredentialsSpy: ReturnType<typeof vi.fn>;
  let setAdminSetupCompletedSpy: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    mockConfig.ADMIN_EMAIL = undefined;
    mockConfig.ADMIN_PASSWORD_HASH = undefined;
    setAdminCredentialsSpy = vi.fn().mockResolvedValue(undefined);
    setAdminSetupCompletedSpy = vi.fn().mockResolvedValue(undefined);

    ({ server } = await buildFreshServer({
      withSettings: {
        getAdminSetupCompleted: vi.fn().mockResolvedValue(false),
        setAdminSetupCompleted: setAdminSetupCompletedSpy,
        getAdminCredentials: vi.fn().mockResolvedValue(null),
        setAdminCredentials: setAdminCredentialsSpy,
      },
    }));
  });

  afterEach(async () => {
    await server.close();
  });

  it("200 ve ok:true döner (kurulum tamamlanmamışken)", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/",
      payload: VALID_PAYLOAD,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(typeof body.message).toBe("string");
  });

  it("email response'da döner", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/",
      payload: VALID_PAYLOAD,
    });
    expect(res.json().email).toBe("admin@example.com");
  });

  it("DB'ye credentials yazıldı (setAdminCredentials çağrıldı)", async () => {
    await server.inject({
      method: "POST",
      url: "/",
      payload: VALID_PAYLOAD,
    });

    expect(setAdminCredentialsSpy).toHaveBeenCalledOnce();
    const [emailArg, hashArg] = setAdminCredentialsSpy.mock.calls[0] as [string, string];
    expect(emailArg).toBe("admin@example.com");
    expect(hashArg).toBe("$argon2id$hashed");
  });

  it("DB'ye setup completed flag yazıldı (setAdminSetupCompleted çağrıldı)", async () => {
    await server.inject({
      method: "POST",
      url: "/",
      payload: VALID_PAYLOAD,
    });

    expect(setAdminSetupCompletedSpy).toHaveBeenCalledOnce();
  });

  it("fs atomik write (writeFileSync) çağrıldı", async () => {
    const fsModule = await import("node:fs");
    const writeSpy = vi.spyOn(fsModule.default, "writeFileSync");

    await server.inject({
      method: "POST",
      url: "/",
      payload: VALID_PAYLOAD,
    });

    expect(writeSpy).toHaveBeenCalled();
    const writtenContent = writeSpy.mock.calls[0]?.[1] as string;
    expect(writtenContent).toContain("ADMIN_EMAIL=admin@example.com");
    expect(writtenContent).toContain("ADMIN_PASSWORD_HASH=");
    expect(writtenContent).toContain("PG_HOST=localhost");
    expect(writtenContent).toContain("PG_USER=postgres");
  });

  it("configured=true iken 403 döner (DB'de admin var)", async () => {
    // Yeni isConfiguredAsync mantığı DB'deki admin varlığına bakıyor.
    // Bu test için DB'de admin var olan ayrı bir server kurmamız gerekiyor.
    await server.close();

    const configuredServer = Fastify({ logger: false });
    configuredServer.decorate("settings", {
      getAdminSetupCompleted: vi.fn().mockResolvedValue(true),
      setAdminSetupCompleted: vi.fn().mockResolvedValue(undefined),
      getAdminCredentials: vi.fn().mockResolvedValue({
        email: "existing@example.com",
        passwordHash: "$argon2id$existing",
      }),
      setAdminCredentials: vi.fn().mockResolvedValue(undefined),
    });

    vi.resetModules();
    const { setupRoutes } = await import("../../src/routes/setup.js");
    await configuredServer.register(setupRoutes);
    await configuredServer.ready();

    try {
      const res = await configuredServer.inject({
        method: "POST",
        url: "/",
        payload: VALID_PAYLOAD,
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().error).toMatch(/already completed/i);
    } finally {
      await configuredServer.close();
    }
  });

  it("eksik alan → 400 döner", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/",
      payload: { adminEmail: "x@y.com" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("geçersiz email → 400 döner", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/",
      payload: { ...VALID_PAYLOAD, adminEmail: "not-an-email" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("8 karakterden kısa şifre → 400 döner", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/",
      payload: { ...VALID_PAYLOAD, adminPassword: "short" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("geçersiz port → 400 döner", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/",
      payload: { ...VALID_PAYLOAD, pgPort: 99999 },
    });
    expect(res.statusCode).toBe(400);
  });

  it("Docker mod: .env yazılamıyor → DB credentials yine de yazıldı", async () => {
    // fs.writeFileSync EACCES fırlatıyor — Docker container simülasyonu
    const fsModule = await import("node:fs");
    vi.spyOn(fsModule.default, "writeFileSync").mockImplementation(() => {
      throw Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" });
    });

    const res = await server.inject({
      method: "POST",
      url: "/",
      payload: VALID_PAYLOAD,
    });

    // Setup başarılı olmalı
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);

    // DB'ye credentials yazıldı mı?
    expect(setAdminCredentialsSpy).toHaveBeenCalledOnce();
    expect(setAdminSetupCompletedSpy).toHaveBeenCalledOnce();

    // Message Docker modunu belirtiyor
    expect(res.json().message).toContain("Docker mode");

    // Mock'u geri al
    vi.restoreAllMocks();
  });

  it("DB'ye credentials yazma başarısız olsa bile setup 200 döner (graceful)", async () => {
    const failingSetCredsSpy = vi.fn().mockRejectedValue(new Error("DB write failed"));

    // settings decorator'ı override et
    const freshServer = Fastify({ logger: false });
    freshServer.decorate("settings", {
      getAdminSetupCompleted: vi.fn().mockResolvedValue(false),
      setAdminSetupCompleted: vi.fn().mockRejectedValue(new Error("DB write failed")),
      getAdminCredentials: vi.fn().mockResolvedValue(null),
      setAdminCredentials: failingSetCredsSpy,
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

// ─────────────────────────────────────────────────────────────────────────────
// Container restart recovery — POST /setup ardından setup flag sıfırlanıp
// DB flag'e dayanarak configured=true dönmeli
// ─────────────────────────────────────────────────────────────────────────────

describe("Container restart recovery", () => {
  it("Setup sonrası flag sıfırlanınca DB'deki admin kaydından configured=true okunur", async () => {
    // Simülasyon:
    // 1. Setup yapıldı → DB'de admin credentials yazıldı
    // 2. Container restart → _setupCompleted = null, config boş
    // 3. /setup/status → DB'ye sor → admin bulundu → true döner

    mockConfig.ADMIN_EMAIL = undefined;
    mockConfig.ADMIN_PASSWORD_HASH = undefined;

    // DB'de admin var
    const { server, resetFlag } = await buildFreshServer({
      withSettings: {
        getAdminCredentials: vi.fn().mockResolvedValue({
          email: "admin@example.com",
          passwordHash: "$argon2id$hash",
        }),
      },
    });

    // Restart simülasyonu: flag sıfırla
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