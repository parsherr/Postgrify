/**
 * HIGH-A: Password complexity policy tests.
 *
 * Tests validatePassword() and parsePolicyFromSettings() functions.
 * These utilities are used in the signup and passwordReset endpoints.
 */

import { describe, it, expect } from "vitest";
import {
  validatePassword,
  parsePolicyFromSettings,
  DEFAULT_PASSWORD_POLICY,
  type PasswordPolicy,
} from "../../src/utils/passwordPolicy.js";

describe("validatePassword — default policy", () => {
  it("8+ characters passes", () => {
    expect(validatePassword("securePass1").valid).toBe(true);
  });

  it("7 characters fails", () => {
    const r = validatePassword("short12");
    expect(r.valid).toBe(false);
    expect(r.message).toMatch(/at least 8/);
  });

  it("empty string fails", () => {
    expect(validatePassword("").valid).toBe(false);
  });

  it("whitespace-only password fails", () => {
    const r = validatePassword("        ");
    expect(r.valid).toBe(false);
    expect(r.message).toMatch(/whitespace/);
  });

  it("all same characters (default policy) passes — complexity not required", () => {
    expect(validatePassword("aaaaaaaa").valid).toBe(true);
  });
});

describe("validatePassword — uppercase required", () => {
  const policy: Partial<PasswordPolicy> = { requireUppercase: true };

  it("password with uppercase passes", () => {
    expect(validatePassword("Password1", policy).valid).toBe(true);
  });

  it("password without uppercase fails", () => {
    const r = validatePassword("password1", policy);
    expect(r.valid).toBe(false);
    expect(r.message).toMatch(/uppercase/);
  });
});

describe("validatePassword — number required", () => {
  const policy: Partial<PasswordPolicy> = { requireNumber: true };

  it("password with number passes", () => {
    expect(validatePassword("Password1", policy).valid).toBe(true);
  });

  it("password without number fails", () => {
    const r = validatePassword("PasswordX", policy);
    expect(r.valid).toBe(false);
    expect(r.message).toMatch(/number/);
  });
});

describe("validatePassword — special character required", () => {
  const policy: Partial<PasswordPolicy> = { requireSpecial: true };

  it("password with special character passes", () => {
    expect(validatePassword("Pass@word1", policy).valid).toBe(true);
    expect(validatePassword("Pass!word", policy).valid).toBe(true);
    expect(validatePassword("Pass#123", policy).valid).toBe(true);
  });

  it("password without special character fails", () => {
    const r = validatePassword("Password1", policy);
    expect(r.valid).toBe(false);
    expect(r.message).toMatch(/special/);
  });
});

describe("validatePassword — custom minLength", () => {
  const policy: Partial<PasswordPolicy> = { minLength: 12 };

  it("12+ characters passes", () => {
    expect(validatePassword("longpassword", policy).valid).toBe(true);
  });

  it("11 characters fails", () => {
    const r = validatePassword("shortpasswrd", policy);
    // 12 characters not 12 → wait "shortpasswrd" is 12 chars; test with 11
    const r2 = validatePassword("shortpass1x", policy);
    expect(r2.valid).toBe(false);
    expect(r2.message).toMatch(/at least 12/);
  });
});

describe("validatePassword — combined policy", () => {
  const policy: Partial<PasswordPolicy> = {
    minLength: 10,
    requireUppercase: true,
    requireNumber: true,
    requireSpecial: true,
  };

  it("password meeting all rules passes", () => {
    expect(validatePassword("Secure@123!", policy).valid).toBe(true);
  });

  it("password not meeting rules fails", () => {
    expect(validatePassword("password", policy).valid).toBe(false);
  });
});

describe("parsePolicyFromSettings", () => {
  it("empty settings → returns default policy", () => {
    const p = parsePolicyFromSettings({});
    expect(p).toEqual({});
  });

  it("min_password_length parses integer", () => {
    const p = parsePolicyFromSettings({ min_password_length: "12" });
    expect(p.minLength).toBe(12);
  });

  it("invalid integer → skipped", () => {
    const p = parsePolicyFromSettings({ min_password_length: "abc" });
    expect(p.minLength).toBeUndefined();
  });

  it("require flags parse as true", () => {
    const p = parsePolicyFromSettings({
      password_require_uppercase: "true",
      password_require_number:    "true",
      password_require_special:   "true",
    });
    expect(p.requireUppercase).toBe(true);
    expect(p.requireNumber).toBe(true);
    expect(p.requireSpecial).toBe(true);
  });

  it("false string → flag is not set", () => {
    const p = parsePolicyFromSettings({
      password_require_uppercase: "false",
    });
    expect(p.requireUppercase).toBeUndefined();
  });
});

describe("DEFAULT_PASSWORD_POLICY", () => {
  it("min 8 characters, no complexity requirements", () => {
    expect(DEFAULT_PASSWORD_POLICY.minLength).toBe(8);
    expect(DEFAULT_PASSWORD_POLICY.requireUppercase).toBe(false);
    expect(DEFAULT_PASSWORD_POLICY.requireNumber).toBe(false);
    expect(DEFAULT_PASSWORD_POLICY.requireSpecial).toBe(false);
  });
});