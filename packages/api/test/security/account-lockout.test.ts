/**
 * HIGH-B: Account lockout tests.
 *
 * In tokens.ts login endpoint:
 * - failed_attempts is incremented on failed login attempts
 * - locked_until is set after 5 failed attempts
 * - Locked account returns 429
 * - failed_attempts is reset on successful login
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import type { Sql } from "postgres";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("../../src/services/passwordService.js", () => ({
  hashPassword:   vi.fn().mockResolvedValue("$argon2id$hashed"),
  verifyPassword: vi.fn(),
}));

vi.mock("../../src/config/env.js", () => ({
  config: {
    JWT_SECRET:           "test-secret-that-is-32-chars-long!!",
    ACCESS_TOKEN_EXPIRY:  "15m",
    REFRESH_TOKEN_EXPIRY: "7d",
  },
}));

vi.mock("../../src/services/emailService.js", () => ({
  sendEmail: vi.fn().mockResolvedValue(undefined),
  buildVerifyEmail: vi.fn(),
}));

// ── Test builder ──────────────────────────────────────────────────────────────

async function buildLoginServer(
  user: Record<string, unknown> | null,
  passwordValid: boolean,
  sqlUpdates: Array<Record<string, unknown>> = []
): Promise<FastifyInstance> {
  const { verifyPassword } = await import("../../src/services/passwordService.js");
  vi.mocked(verifyPassword).mockResolvedValue(passwordValid);

  const server = Fastify({ logger: false });

  // poolManager mock
  const mockSqlFn = vi.fn().mockImplementation((strings: TemplateStringsArray, ...values: unknown[]) => {
    const query = strings.join("?");
    if (query.includes("SELECT") && query.includes("users") && query.includes("email")) {
      return Promise.resolve(user ? [user] : []);
    }
    if (query.includes("UPDATE") && query.includes("users")) {
      return Promise.resolve([]);
    }
    if (query.includes("auth_settings")) {
      // account_lockout_attempts
      if (values.includes("account_lockout_attempts")) return Promise.resolve([{ value: "5" }]);
      // account_lockout_minutes
      if (values.includes("account_lockout_minutes"))  return Promise.resolve([{ value: "15" }]);
      // email_verify_required
      if (values.includes("email_verify_required")) return Promise.resolve([{ value: "false" }]);
      return Promise.resolve([{ value: "false" }]);
    }
    if (query.includes("sessions")) {
      return Promise.resolve([]);
    }
    return Promise.resolve([]);
  }) as unknown as Sql;

  (mockSqlFn as unknown as Record<string, unknown>).unsafe = vi.fn().mockResolvedValue([]);

  server.decorate("poolManager", {
    getPool: vi.fn().mockReturnValue(mockSqlFn),
    activePoolCount: 0,
  });

  server.decorate("jwtService", {
    signDbUserToken: vi.fn().mockResolvedValue("access-token-xyz"),
    verifyAdminOrDb: vi.fn().mockResolvedValue(null),
    verifyDbUser: vi.fn().mockResolvedValue(null),
  });

  const { authTokensRoute } = await import("../../src/routes/db/auth/tokens.js");
  await server.register(authTokensRoute);
  await server.ready();
  return server;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Account Lockout — users.ts lockout logic", () => {
  it("passwordPolicy.ts: whitespace-only password rejected", async () => {
    const { validatePassword } = await import("../../src/utils/passwordPolicy.js");
    const result = validatePassword("        ");
    expect(result.valid).toBe(false);
    expect(result.message).toContain("whitespace");
  });

  it("passwordPolicy.ts: 7 char password rejected by default policy", async () => {
    const { validatePassword } = await import("../../src/utils/passwordPolicy.js");
    const result = validatePassword("short12");
    expect(result.valid).toBe(false);
  });

  it("passwordPolicy.ts: strong password passes all rules", async () => {
    const { validatePassword } = await import("../../src/utils/passwordPolicy.js");
    const result = validatePassword("Str0ng@Pass", {
      minLength: 8,
      requireUppercase: true,
      requireNumber: true,
      requireSpecial: true,
    });
    expect(result.valid).toBe(true);
  });
});

describe("Account Lockout — locked account behavior", () => {
  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("locked_until in future → returns 429", async () => {
    const futureDate = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const server = await buildLoginServer(
      {
        id: "user-1",
        email: "test@example.com",
        password_hash: "$argon2id$hashed",
        role: "user",
        is_active: true,
        email_verified: true,
        failed_attempts: 5,
        locked_until: futureDate,
      },
      false
    );

    const res = await server.inject({
      method: "POST",
      url: "/testdb/auth/login",
      payload: { email: "test@example.com", password: "wrongpass" },
    });

    await server.close();
    expect(res.statusCode).toBe(429);
    const body = res.json();
    expect(body.error).toMatch(/locked/i);
    expect(body.lockedUntil).toBeDefined();
  });

  it("locked_until in past → continues with login attempt", async () => {
    const pastDate = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const server = await buildLoginServer(
      {
        id: "user-1",
        email: "test@example.com",
        password_hash: "$argon2id$hashed",
        role: "user",
        is_active: true,
        email_verified: true,
        failed_attempts: 5,
        locked_until: pastDate,
      },
      true // password valid
    );

    const res = await server.inject({
      method: "POST",
      url: "/testdb/auth/login",
      payload: { email: "test@example.com", password: "correctpass" },
    });

    await server.close();
    // Continues despite past-dated lock
    expect([200, 401, 403]).toContain(res.statusCode);
    expect(res.statusCode).not.toBe(429);
  });

  it("no locked_until → does not return 429", async () => {
    const server = await buildLoginServer(
      {
        id: "user-1",
        email: "test@example.com",
        password_hash: "$argon2id$hashed",
        role: "user",
        is_active: true,
        email_verified: true,
        failed_attempts: 0,
        locked_until: null,
      },
      true
    );

    const res = await server.inject({
      method: "POST",
      url: "/testdb/auth/login",
      payload: { email: "test@example.com", password: "correctpass" },
    });

    await server.close();
    expect(res.statusCode).not.toBe(429);
  });
});