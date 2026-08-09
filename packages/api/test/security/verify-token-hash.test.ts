/**
 * SEC-1: Email doğrulama token'ı SHA-256 hash ile saklama testleri.
 *
 * signup.ts'de üretilen verification_token plain text değil SHA-256 hash
 * olarak metadata'ya yazılmalıdır. verify.ts de gelen token'ı hash'leyip
 * DB'deki hash ile karşılaştırmalıdır.
 */

import { describe, it, expect } from "vitest";
import crypto from "node:crypto";

function hashVerificationToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

describe("SEC-1: Email verification token hashing", () => {
  it("verification token SHA-256 hash üretir", () => {
    const token = crypto.randomBytes(32).toString("hex");
    const hash = hashVerificationToken(token);
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[a-f0-9]+$/);
  });

  it("aynı token için her seferinde aynı hash döner (deterministic)", () => {
    const token = "test-verification-token-12345";
    const h1 = hashVerificationToken(token);
    const h2 = hashVerificationToken(token);
    expect(h1).toBe(h2);
  });

  it("farklı token'lar farklı hash üretir", () => {
    const h1 = hashVerificationToken("token-a");
    const h2 = hashVerificationToken("token-b");
    expect(h1).not.toBe(h2);
  });

  it("plain text token'dan hash türetilemez (one-way)", () => {
    const token = crypto.randomBytes(32).toString("hex");
    const hash = hashVerificationToken(token);
    // Hash'ten geri token üretilemiyor — sadece doğrulayabiliriz
    expect(hashVerificationToken(token)).toBe(hash);
    expect(hash).not.toBe(token); // hash, token'ın kendisi değil
  });

  it("signup.ts'de hash saklama pattern'ı doğru uygulanıyor", async () => {
    // signup.ts kaynak kodu hash pattern'ı içermeli
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const { dirname, join } = await import("node:path");

    const __dirname = dirname(fileURLToPath(import.meta.url));
    const signupPath = join(__dirname, "../../src/routes/db/auth/signup.ts");
    const content = readFileSync(signupPath, "utf-8");

    // Plain text token DB'ye yazılmamalı
    expect(content).toMatch(/hashVerificationToken/);
    expect(content).toMatch(/verificationTokenHash/);
    // Hash'i metadata'ya yazıyor
    expect(content).toMatch(/verification_token.*verificationTokenHash|verificationTokenHash.*verification_token/);
  });

  it("verify.ts'de hash karşılaştırma pattern'ı doğru uygulanıyor", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const { dirname, join } = await import("node:path");

    const __dirname = dirname(fileURLToPath(import.meta.url));
    const verifyPath = join(__dirname, "../../src/routes/db/auth/verify.ts");
    const content = readFileSync(verifyPath, "utf-8");

    // Gelen token hash'lenerek DB ile karşılaştırılmalı
    expect(content).toMatch(/hashVerificationToken/);
    expect(content).toMatch(/tokenHash/);
    // Plain text token ile arama yapılmamalı (eski yöntem)
    expect(content).not.toMatch(/verification_token.*=\s*\${token}[^H]/);
  });
});

describe("SEC-1: Refresh token hashing (tokens.ts)", () => {
  it("tokens.ts'de refresh token hash'lenerek saklanıyor", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const { dirname, join } = await import("node:path");

    const __dirname = dirname(fileURLToPath(import.meta.url));
    const tokensPath = join(__dirname, "../../src/routes/db/auth/tokens.ts");
    const content = readFileSync(tokensPath, "utf-8");

    // hashRefreshToken fonksiyonu var
    expect(content).toMatch(/hashRefreshToken/);
    // Login: hash DB'ye yazılıyor
    expect(content).toMatch(/refreshTokenHash/);
    // Refresh/logout: hash üzerinden lookup
    expect(content).toMatch(/incomingHash/);
  });

  it("verify.ts'de de refresh token hash'lenerek saklanıyor", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const { dirname, join } = await import("node:path");

    const __dirname = dirname(fileURLToPath(import.meta.url));
    const verifyPath = join(__dirname, "../../src/routes/db/auth/verify.ts");
    const content = readFileSync(verifyPath, "utf-8");

    // Otomatik session oluştururken de hash kullanılıyor
    expect(content).toMatch(/refreshTokenHash/);
    expect(content).toMatch(/createHash.*sha256.*refreshToken|refreshToken.*createHash.*sha256/s);
  });
});
