/**
 * KRIT-4: Production ortamında placeholder secret'larla başlatma testi.
 *
 * env.ts, production'da bilinen placeholder değerleriyle başlamayı
 * process.exit(1) ile reddeder. Bu testler o davranışı doğrular.
 */

import { describe, it, expect, vi, afterEach } from "vitest";

// process.exit'i mock'la — gerçek exit istemiyoruz
const mockExit = vi.spyOn(process, "exit").mockImplementation((_code?: number) => {
  throw new Error(`process.exit(${_code})`);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  mockExit.mockClear();
});

describe("KRIT-4: Production placeholder secret guard", () => {
  it("production'da bilinen JWT_SECRET placeholder'ı reddeder", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("JWT_SECRET", "placeholder-will-be-replaced-by-setup-wizard-32x");
    vi.stubEnv("ADMIN_SECRET", "a-valid-admin-secret-that-is-long-enough-here");
    vi.stubEnv("PG_PASSWORD", "somepassword");

    await expect(import("../../src/config/env.js")).rejects.toThrow("process.exit(1)");
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("production'da bilinen ADMIN_SECRET placeholder'ı reddeder", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("JWT_SECRET", "a-cryptographically-random-jwt-secret-that-is-long-enough");
    vi.stubEnv("ADMIN_SECRET", "placeholder-setup-16x");
    vi.stubEnv("PG_PASSWORD", "somepassword");

    await expect(import("../../src/config/env.js")).rejects.toThrow("process.exit(1)");
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("production'da boş PG_PASSWORD reddedilir", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("JWT_SECRET", "a-cryptographically-random-jwt-secret-that-is-long-enough");
    vi.stubEnv("ADMIN_SECRET", "a-valid-admin-secret-that-is-long-enough-here");
    vi.stubEnv("PG_PASSWORD", "");

    await expect(import("../../src/config/env.js")).rejects.toThrow("process.exit(1)");
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("development'ta placeholder secret'lar kabul edilir", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("JWT_SECRET", "placeholder-will-be-replaced-by-setup-wizard-32x");
    vi.stubEnv("ADMIN_SECRET", "placeholder-setup-16x");
    vi.stubEnv("PG_PASSWORD", "");

    // development'ta exit çağrılmamalı
    await expect(import("../../src/config/env.js")).resolves.toBeDefined();
    expect(mockExit).not.toHaveBeenCalled();
  });

  it("production'da gerçek secret'larla başlatma başarılı olur", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("JWT_SECRET", "a-cryptographically-random-jwt-secret-that-is-long-enough");
    vi.stubEnv("ADMIN_SECRET", "a-valid-admin-secret-that-is-long-enough-here");
    vi.stubEnv("PG_PASSWORD", "securepassword");

    await expect(import("../../src/config/env.js")).resolves.toBeDefined();
    expect(mockExit).not.toHaveBeenCalled();
  });

  it("JWT_SECRET 32 karakterden kısa ise başlatma başarısız olur", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("JWT_SECRET", "tooshort");

    await expect(import("../../src/config/env.js")).rejects.toThrow("process.exit(1)");
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("ADMIN_SECRET 16 karakterden kısa ise başlatma başarısız olur", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("JWT_SECRET", "a-cryptographically-random-jwt-secret-that-is-long-enough");
    vi.stubEnv("ADMIN_SECRET", "tooshort");

    await expect(import("../../src/config/env.js")).rejects.toThrow("process.exit(1)");
    expect(mockExit).toHaveBeenCalledWith(1);
  });
});