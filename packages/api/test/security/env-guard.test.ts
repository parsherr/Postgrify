/**
 * KRIT-4: Test for startup with placeholder secrets in production.
 *
 * env.ts rejects startup with known placeholder values in production
 * via process.exit(1). These tests verify that behavior.
 */

import { describe, it, expect, vi, afterEach } from "vitest";

// Mock process.exit — we do not want a real exit
const mockExit = vi.spyOn(process, "exit").mockImplementation((_code?: number) => {
  throw new Error(`process.exit(${_code})`);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  mockExit.mockClear();
});

describe("KRIT-4: Production placeholder secret guard", () => {
  it("rejects known JWT_SECRET placeholder in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("JWT_SECRET", "placeholder-will-be-replaced-by-setup-wizard-32x");
    vi.stubEnv("ADMIN_SECRET", "a-valid-admin-secret-that-is-long-enough-here");
    vi.stubEnv("PG_PASSWORD", "somepassword");

    await expect(import("../../src/config/env.js")).rejects.toThrow("process.exit(1)");
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("rejects known ADMIN_SECRET placeholder in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("JWT_SECRET", "a-cryptographically-random-jwt-secret-that-is-long-enough");
    vi.stubEnv("ADMIN_SECRET", "placeholder-setup-16x");
    vi.stubEnv("PG_PASSWORD", "somepassword");

    await expect(import("../../src/config/env.js")).rejects.toThrow("process.exit(1)");
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("rejects empty PG_PASSWORD in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("JWT_SECRET", "a-cryptographically-random-jwt-secret-that-is-long-enough");
    vi.stubEnv("ADMIN_SECRET", "a-valid-admin-secret-that-is-long-enough-here");
    vi.stubEnv("PG_PASSWORD", "");

    await expect(import("../../src/config/env.js")).rejects.toThrow("process.exit(1)");
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("placeholder secrets are accepted in development", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("JWT_SECRET", "placeholder-will-be-replaced-by-setup-wizard-32x");
    vi.stubEnv("ADMIN_SECRET", "placeholder-setup-16x");
    vi.stubEnv("PG_PASSWORD", "");

    // exit must not be called in development
    await expect(import("../../src/config/env.js")).resolves.toBeDefined();
    expect(mockExit).not.toHaveBeenCalled();
  });

  it("startup with real secrets succeeds in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("JWT_SECRET", "a-cryptographically-random-jwt-secret-that-is-long-enough");
    vi.stubEnv("ADMIN_SECRET", "a-valid-admin-secret-that-is-long-enough-here");
    vi.stubEnv("PG_PASSWORD", "securepassword");

    await expect(import("../../src/config/env.js")).resolves.toBeDefined();
    expect(mockExit).not.toHaveBeenCalled();
  });

  it("startup fails when JWT_SECRET is shorter than 32 characters", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("JWT_SECRET", "tooshort");

    await expect(import("../../src/config/env.js")).rejects.toThrow("process.exit(1)");
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("startup fails when ADMIN_SECRET is shorter than 16 characters", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("JWT_SECRET", "a-cryptographically-random-jwt-secret-that-is-long-enough");
    vi.stubEnv("ADMIN_SECRET", "tooshort");

    await expect(import("../../src/config/env.js")).rejects.toThrow("process.exit(1)");
    expect(mockExit).toHaveBeenCalledWith(1);
  });
});