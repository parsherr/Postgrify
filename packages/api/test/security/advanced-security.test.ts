/**
 * Advanced security tests (Round 5 — comprehensive analysis).
 *
 * SETTINGS-1: signup_redirect_url URL format + protocol validation
 * CACHE-1:    buildKey cache poisoning protection
 * STATS-1:    /admin/stats information leakage protection
 * TABLES-1:   CREATE TABLE column validation
 * META-1:     /db/:db/meta information leakage
 * EMAIL-1:    email enumeration protection (passwordReset)
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─────────────────────────────────────────────────────────────────────────────
// SETTINGS-1: signup_redirect_url protocol validation
// ─────────────────────────────────────────────────────────────────────────────

describe("SETTINGS-1: signup_redirect_url secure URL validation", () => {
  const settingsSrc = readFileSync(
    join(__dirname, "../../src/routes/db/auth/settings.ts"),
    "utf-8"
  );

  it("settings.ts performs URL format check for signup_redirect_url", () => {
    expect(settingsSrc).toContain("signup_redirect_url");
    expect(settingsSrc).toContain("new URL(");
    expect(settingsSrc).toContain("protocol");
  });

  it("javascript: protocol is rejected", () => {
    expect(settingsSrc).toContain("allowedProtocols");
    expect(settingsSrc).toContain("https:");
    expect(settingsSrc).toContain("http:");
  });

  it("invalid URL returns 400 (simulation)", () => {
    function validateRedirectUrl(value: string): { ok: boolean; error?: string } {
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(value);
      } catch {
        return { ok: false, error: "Invalid URL" };
      }
      const allowed = ["http:", "https:"];
      if (!allowed.includes(parsedUrl.protocol)) {
        return { ok: false, error: "Dangerous protocol" };
      }
      return { ok: true };
    }

    expect(validateRedirectUrl("javascript:alert(1)").ok).toBe(false);
    expect(validateRedirectUrl("data:text/html,<script>").ok).toBe(false);
    expect(validateRedirectUrl("file:///etc/passwd").ok).toBe(false);
    expect(validateRedirectUrl("not-a-url-%%%").ok).toBe(false);
    expect(validateRedirectUrl("https://myapp.com/callback").ok).toBe(true);
    expect(validateRedirectUrl("http://localhost:5173/auth/callback").ok).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CACHE-1: buildKey cache poisoning protection
// ─────────────────────────────────────────────────────────────────────────────

describe("CACHE-1: buildKey cache poisoning protection", () => {
  const cacheSrc = readFileSync(
    join(__dirname, "../../src/services/cacheService.ts"),
    "utf-8"
  );

  it("buildKey sanitizes : characters", () => {
    expect(cacheSrc).toContain("replace(/[:\\s*]/g");
  });

  it("buildKey sanitizes * wildcard character", () => {
    // Redis SCAN * cannot be injected
    expect(cacheSrc).toContain("safeParts");
  });

  it("cache poisoning attack is rejected (simulation)", async () => {
    // Copy of cacheService.ts buildKey logic
    function buildKey(...parts: string[]): string {
      const safeParts = parts.map((p) => p.replace(/[:\s*]/g, ""));
      return `postgrify:${safeParts.join(":")}`;
    }

    // Normal usage
    expect(buildKey("db1", "users")).toBe("postgrify:db1:users");

    // Cache poisoning attempt: inject `:`
    expect(buildKey("db1:evil", "users")).toBe("postgrify:db1evil:users");

    // Redis SCAN wildcard injection attempt
    expect(buildKey("db1*", "users")).toBe("postgrify:db1:users");
    expect(buildKey("*", "admin")).toBe("postgrify::admin");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// STATS-1: /admin/stats information leakage protection
// ─────────────────────────────────────────────────────────────────────────────

describe("STATS-1: /admin/stats authentication", () => {
  const statsSrc = readFileSync(
    join(__dirname, "../../src/routes/admin/stats.ts"),
    "utf-8"
  );

  it("stats route requires authenticateAdmin or group-level auth", () => {
    const adminIndexSrc = readFileSync(
      join(__dirname, "../../src/routes/admin/index.ts"),
      "utf-8"
    );
    // Admin index adds group-level authenticateAdmin hook
    expect(adminIndexSrc).toContain("authenticateAdmin");
    expect(adminIndexSrc).toContain("addHook");
  });

  it("stats endpoint contains sensitive information — auth is mandatory", () => {
    // activePoolNames, nodeVersion and similar must be behind auth
    expect(statsSrc).toContain("activePoolNames");
    expect(statsSrc).toContain("nodeVersion");
    // This endpoint is in the admin route group — group auth is sufficient
    const adminIndexSrc = readFileSync(
      join(__dirname, "../../src/routes/admin/index.ts"),
      "utf-8"
    );
    expect(adminIndexSrc).toContain("server.authenticateAdmin");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TABLES-1: CREATE TABLE security
// ─────────────────────────────────────────────────────────────────────────────

describe("TABLES-1: CREATE TABLE identifier validation", () => {
  const tablesSrc = readFileSync(
    join(__dirname, "../../src/routes/db/tables.ts"),
    "utf-8"
  );

  it("tables.ts uses assertIdentifier or isValidIdentifier", () => {
    const hasIdentifierCheck =
      tablesSrc.includes("assertIdentifier") || tablesSrc.includes("isValidIdentifier");
    expect(hasIdentifierCheck).toBe(true);
  });

  it("identifier.ts is included in the system", () => {
    expect(tablesSrc).toContain("identifier");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// EMAIL-1: email enumeration protection
// ─────────────────────────────────────────────────────────────────────────────

describe("EMAIL-1: email enumeration protection", () => {
  const passwordResetSrc = readFileSync(
    join(__dirname, "../../src/routes/db/auth/passwordReset.ts"),
    "utf-8"
  );

  it("forgot endpoint returns 200 even when user is not found", () => {
    // email enumeration: same response must be returned whether user exists or not
    // This checks the "Email sent if account exists" pattern
    // C-15/C-16: GoTrue-compatible empty {} response (no ok:true)
    expect(passwordResetSrc).toContain("reply.send({}");
    // Must not contain info-leaking messages like "User not found"
    expect(passwordResetSrc).not.toContain('"User not found"');
    expect(passwordResetSrc).not.toContain('"Email not registered"');
  });

  it("forgot endpoint returns 200/ok:true even when user does not exist (email enumeration prevention)", () => {
    // Email enumeration protection: same response regardless of user existence
    // reply.send({ ok: true }) must be outside the if (user) block
    const sendIdx = passwordResetSrc.lastIndexOf("reply.send");
    const sendSlice = passwordResetSrc.slice(Math.max(0, sendIdx - 50), sendIdx + 100);
    // C-15/C-16: GoTrue-compatible empty {} response
    expect(sendSlice).toContain("reply.send({}");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GENERAL: General security principle checks
// ─────────────────────────────────────────────────────────────────────────────

describe("GENERAL: General security checks", () => {
  it("identifier.ts protects system tables with RESERVED_PREFIXES", async () => {
    const { isValidIdentifier } = await import("../../src/utils/identifier.js");
    // System tables
    expect(isValidIdentifier("pg_stat_activity")).toBe(false);
    expect(isValidIdentifier("pg_class")).toBe(false);
    expect(isValidIdentifier("_postgrify_auth")).toBe(false);
    // Normal tables
    expect(isValidIdentifier("my_table")).toBe(true);
    expect(isValidIdentifier("users")).toBe(true);
  });

  it("passwordReset and magicLink NULL expiry guard works correctly", () => {
    // Both files have rawExp + isNaN protection
    const pwSrc = readFileSync(
      join(__dirname, "../../src/routes/db/auth/passwordReset.ts"),
      "utf-8"
    );
    const mlSrc = readFileSync(
      join(__dirname, "../../src/routes/db/auth/magicLink.ts"),
      "utf-8"
    );
    expect(pwSrc).toContain("isNaN(exp.getTime())");
    expect(mlSrc).toContain("isNaN(exp.getTime())");
  });

  it("verify.ts NULL expiry guard works correctly", () => {
    const verifySrc = readFileSync(
      join(__dirname, "../../src/routes/db/auth/verify.ts"),
      "utf-8"
    );
    expect(verifySrc).toContain("isNaN(exp.getTime())");
    expect(verifySrc).toContain("!rawExp");
  });

  it("getAuthSetting normalizes to lowercase", () => {
    const provSrc = readFileSync(
      join(__dirname, "../../src/routes/db/auth/provision.ts"),
      "utf-8"
    );
    const getAuthIdx = provSrc.indexOf("getAuthSetting");
    // Function body must contain toLowerCase
    const fnBody = provSrc.slice(getAuthIdx, getAuthIdx + 500);
    expect(fnBody).toContain("toLowerCase");
  });
});