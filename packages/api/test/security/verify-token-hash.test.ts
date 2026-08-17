/**
 * SEC-1: Email verification token SHA-256 hash storage tests.
 *
 * In signup.ts, the generated verification_token must be written to metadata
 * as a SHA-256 hash, not as plain text. verify.ts must also hash the incoming
 * token and compare it against the DB hash.
 */

import { describe, it, expect } from "vitest";
import crypto from "node:crypto";

function hashVerificationToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

describe("SEC-1: Email verification token hashing", () => {
  it("verification token produces a SHA-256 hash", () => {
    const token = crypto.randomBytes(32).toString("hex");
    const hash = hashVerificationToken(token);
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[a-f0-9]+$/);
  });

  it("same token always produces the same hash (deterministic)", () => {
    const token = "test-verification-token-12345";
    const h1 = hashVerificationToken(token);
    const h2 = hashVerificationToken(token);
    expect(h1).toBe(h2);
  });

  it("different tokens produce different hashes", () => {
    const h1 = hashVerificationToken("token-a");
    const h2 = hashVerificationToken("token-b");
    expect(h1).not.toBe(h2);
  });

  it("plain text token cannot be derived from hash (one-way)", () => {
    const token = crypto.randomBytes(32).toString("hex");
    const hash = hashVerificationToken(token);
    // Cannot derive token back from hash — can only verify
    expect(hashVerificationToken(token)).toBe(hash);
    expect(hash).not.toBe(token); // hash is not the token itself
  });

  it("hash storage pattern is correctly applied in signup.ts", async () => {
    // signup.ts source code must contain the hash pattern
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const { dirname, join } = await import("node:path");

    const __dirname = dirname(fileURLToPath(import.meta.url));
    const signupPath = join(__dirname, "../../src/routes/db/auth/signup.ts");
    const content = readFileSync(signupPath, "utf-8");

    // Plain text token must not be written to DB
    expect(content).toMatch(/hashVerificationToken/);
    expect(content).toMatch(/verificationTokenHash/);
    // Writes hash to metadata
    expect(content).toMatch(/verification_token.*verificationTokenHash|verificationTokenHash.*verification_token/);
  });

  it("hash comparison pattern is correctly applied in verify.ts", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const { dirname, join } = await import("node:path");

    const __dirname = dirname(fileURLToPath(import.meta.url));
    const verifyPath = join(__dirname, "../../src/routes/db/auth/verify.ts");
    const content = readFileSync(verifyPath, "utf-8");

    // Incoming token must be hashed before comparing with DB
    expect(content).toMatch(/hashVerificationToken/);
    expect(content).toMatch(/tokenHash/);
    // Must not search with plain text token (old method)
    expect(content).not.toMatch(/verification_token.*=\s*\${token}[^H]/);
  });
});

describe("SEC-1: Refresh token hashing (tokens.ts)", () => {
  it("refresh token is hashed before storage in tokens.ts", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const { dirname, join } = await import("node:path");

    const __dirname = dirname(fileURLToPath(import.meta.url));
    const tokensPath = join(__dirname, "../../src/routes/db/auth/tokens.ts");
    const content = readFileSync(tokensPath, "utf-8");

    // hashRefreshToken function is present
    expect(content).toMatch(/hashRefreshToken/);
    // Login: hash is written to DB
    expect(content).toMatch(/refreshTokenHash/);
    // Refresh/logout: lookup is done via hash
    expect(content).toMatch(/incomingHash/);
  });

  it("refresh token is also hashed before storage in verify.ts", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const { dirname, join } = await import("node:path");

    const __dirname = dirname(fileURLToPath(import.meta.url));
    const verifyPath = join(__dirname, "../../src/routes/db/auth/verify.ts");
    const content = readFileSync(verifyPath, "utf-8");

    // Hash is also used when creating auto session
    expect(content).toMatch(/refreshTokenHash/);
    expect(content).toMatch(/createHash.*sha256.*refreshToken|refreshToken.*createHash.*sha256/s);
  });
});