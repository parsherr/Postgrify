/**
 * HIGH-A: Şifre kompleksitesi politikası testleri.
 *
 * validatePassword() ve parsePolicyFromSettings() fonksiyonlarını test eder.
 * Signup ve passwordReset endpoint'lerinde bu util kullanılır.
 */

import { describe, it, expect } from "vitest";
import {
  validatePassword,
  parsePolicyFromSettings,
  DEFAULT_PASSWORD_POLICY,
  type PasswordPolicy,
} from "../../src/utils/passwordPolicy.js";

describe("validatePassword — varsayılan politika", () => {
  it("8+ karakter geçer", () => {
    expect(validatePassword("securePass1").valid).toBe(true);
  });

  it("7 karakter başarısız olur", () => {
    const r = validatePassword("short12");
    expect(r.valid).toBe(false);
    expect(r.message).toMatch(/at least 8/);
  });

  it("boş string başarısız olur", () => {
    expect(validatePassword("").valid).toBe(false);
  });

  it("sadece boşluklardan oluşan şifre başarısız olur", () => {
    const r = validatePassword("        ");
    expect(r.valid).toBe(false);
    expect(r.message).toMatch(/whitespace/);
  });

  it("tüm aynı karakterler (varsayılan politika) geçer — komplekslik zorunlu değil", () => {
    expect(validatePassword("aaaaaaaa").valid).toBe(true);
  });
});

describe("validatePassword — büyük harf zorunlu", () => {
  const policy: Partial<PasswordPolicy> = { requireUppercase: true };

  it("büyük harf içeren şifre geçer", () => {
    expect(validatePassword("Password1", policy).valid).toBe(true);
  });

  it("büyük harf içermeyen şifre başarısız olur", () => {
    const r = validatePassword("password1", policy);
    expect(r.valid).toBe(false);
    expect(r.message).toMatch(/uppercase/);
  });
});

describe("validatePassword — sayı zorunlu", () => {
  const policy: Partial<PasswordPolicy> = { requireNumber: true };

  it("sayı içeren şifre geçer", () => {
    expect(validatePassword("Password1", policy).valid).toBe(true);
  });

  it("sayı içermeyen şifre başarısız olur", () => {
    const r = validatePassword("PasswordX", policy);
    expect(r.valid).toBe(false);
    expect(r.message).toMatch(/number/);
  });
});

describe("validatePassword — özel karakter zorunlu", () => {
  const policy: Partial<PasswordPolicy> = { requireSpecial: true };

  it("özel karakter içeren şifre geçer", () => {
    expect(validatePassword("Pass@word1", policy).valid).toBe(true);
    expect(validatePassword("Pass!word", policy).valid).toBe(true);
    expect(validatePassword("Pass#123", policy).valid).toBe(true);
  });

  it("özel karakter içermeyen şifre başarısız olur", () => {
    const r = validatePassword("Password1", policy);
    expect(r.valid).toBe(false);
    expect(r.message).toMatch(/special/);
  });
});

describe("validatePassword — özel minLength", () => {
  const policy: Partial<PasswordPolicy> = { minLength: 12 };

  it("12+ karakter geçer", () => {
    expect(validatePassword("longpassword", policy).valid).toBe(true);
  });

  it("11 karakter başarısız olur", () => {
    const r = validatePassword("shortpasswrd", policy);
    // 12 karakter değil 12 → wait "shortpasswrd" is 12 chars; test with 11
    const r2 = validatePassword("shortpass1x", policy);
    expect(r2.valid).toBe(false);
    expect(r2.message).toMatch(/at least 12/);
  });
});

describe("validatePassword — kombine politika", () => {
  const policy: Partial<PasswordPolicy> = {
    minLength: 10,
    requireUppercase: true,
    requireNumber: true,
    requireSpecial: true,
  };

  it("tüm kuralları karşılayan şifre geçer", () => {
    expect(validatePassword("Secure@123!", policy).valid).toBe(true);
  });

  it("kuralları karşılamayan şifre başarısız olur", () => {
    expect(validatePassword("password", policy).valid).toBe(false);
  });
});

describe("parsePolicyFromSettings", () => {
  it("boş settings → varsayılan politika döner", () => {
    const p = parsePolicyFromSettings({});
    expect(p).toEqual({});
  });

  it("min_password_length integer parse eder", () => {
    const p = parsePolicyFromSettings({ min_password_length: "12" });
    expect(p.minLength).toBe(12);
  });

  it("geçersiz integer → atlanır", () => {
    const p = parsePolicyFromSettings({ min_password_length: "abc" });
    expect(p.minLength).toBeUndefined();
  });

  it("require flags true olarak parse eder", () => {
    const p = parsePolicyFromSettings({
      password_require_uppercase: "true",
      password_require_number:    "true",
      password_require_special:   "true",
    });
    expect(p.requireUppercase).toBe(true);
    expect(p.requireNumber).toBe(true);
    expect(p.requireSpecial).toBe(true);
  });

  it("false string → flag eklenmez", () => {
    const p = parsePolicyFromSettings({
      password_require_uppercase: "false",
    });
    expect(p.requireUppercase).toBeUndefined();
  });
});

describe("DEFAULT_PASSWORD_POLICY", () => {
  it("min 8 karakter, komplekslik yok", () => {
    expect(DEFAULT_PASSWORD_POLICY.minLength).toBe(8);
    expect(DEFAULT_PASSWORD_POLICY.requireUppercase).toBe(false);
    expect(DEFAULT_PASSWORD_POLICY.requireNumber).toBe(false);
    expect(DEFAULT_PASSWORD_POLICY.requireSpecial).toBe(false);
  });
});