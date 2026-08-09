/**
 * SettingsService unit testleri.
 *
 * Gerçek DB bağlantısı olmadan test edilir — postgres SQL mock'lanır.
 * Her test kendi mock sql instance'ını kullanır.
 *
 * Test edilenler:
 *   - getAdminCredentials / setAdminCredentials round-trip
 *   - getAdminSetupCompleted / setAdminSetupCompleted
 *   - getAutoStartDatabases / setAutoStartDatabases
 *   - Provision: tablo oluşturma SQL çalışır
 *   - Graceful fallback: provision başarısız → retry
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { SettingsService } from "../../src/services/settingsService.js";
import type { AdminCredentials } from "../../src/services/settingsService.js";

// ─────────────────────────────────────────────────────────────────────────────
// SQL mock fabric
// ─────────────────────────────────────────────────────────────────────────────

/**
 * postgres.js sql tagged template mock'u oluşturur.
 * İlk çağrı provision (CREATE TABLE), sonraki çağrılar veri okuma/yazma.
 */
function makeSqlMock(dataRows: Record<string, string>[] = []) {
  const calls: unknown[][] = [];

  // Tagged template: sql`...` → Promise<rows>
  const sql = vi.fn((...args: unknown[]) => {
    calls.push(args);
    const query = String(args[0]);

    if (query.includes("CREATE TABLE IF NOT EXISTS")) {
      return Promise.resolve([]);
    }
    if (query.includes("SELECT key, value FROM _postgrify_settings")) {
      return Promise.resolve(dataRows);
    }
    if (query.includes("SELECT value FROM _postgrify_settings")) {
      const key = extractWhereKey(String(args[0]));
      const row = dataRows.find((r) => r.key === key);
      return Promise.resolve(row ? [row] : []);
    }
    if (query.includes("INSERT INTO _postgrify_settings")) {
      return Promise.resolve([]);
    }
    return Promise.resolve([]);
  }) as unknown as import("postgres").Sql;

  return { sql, calls };
}

/** WHERE key = '...' den key değerini çıkarır */
function extractWhereKey(query: string): string {
  const match = query.match(/WHERE key = '([^']+)'/);
  return match?.[1] ?? "";
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin credentials
// ─────────────────────────────────────────────────────────────────────────────

describe("getAdminCredentials", () => {
  it("email ve hash varsa döner", async () => {
    const { sql } = makeSqlMock([
      { key: "admin_email", value: "admin@example.com" },
      { key: "admin_password_hash", value: "$argon2id$v=19$hash" },
    ]);
    const svc = new SettingsService(sql);
    const creds = await svc.getAdminCredentials();
    expect(creds).not.toBeNull();
    expect(creds?.email).toBe("admin@example.com");
    expect(creds?.passwordHash).toBe("$argon2id$v=19$hash");
  });

  it("email yoksa null döner", async () => {
    const { sql } = makeSqlMock([
      { key: "admin_password_hash", value: "$argon2id$v=19$hash" },
    ]);
    const svc = new SettingsService(sql);
    const creds = await svc.getAdminCredentials();
    expect(creds).toBeNull();
  });

  it("hash yoksa null döner", async () => {
    const { sql } = makeSqlMock([
      { key: "admin_email", value: "admin@example.com" },
    ]);
    const svc = new SettingsService(sql);
    const creds = await svc.getAdminCredentials();
    expect(creds).toBeNull();
  });

  it("DB boşsa null döner", async () => {
    const { sql } = makeSqlMock([]);
    const svc = new SettingsService(sql);
    const creds = await svc.getAdminCredentials();
    expect(creds).toBeNull();
  });
});

describe("setAdminCredentials", () => {
  it("email ve hash için INSERT çağrısı yapılır", async () => {
    const insertCalls: string[] = [];
    const sql = vi.fn((...args: unknown[]) => {
      const q = String(args[0]);
      if (q.includes("INSERT INTO _postgrify_settings")) {
        insertCalls.push(q);
      }
      return Promise.resolve([]);
    }) as unknown as import("postgres").Sql;

    const svc = new SettingsService(sql);
    await svc.setAdminCredentials("admin@example.com", "$argon2id$hash");

    // email ve passwordHash için ayrı INSERT olmalı
    expect(insertCalls.length).toBeGreaterThanOrEqual(2);
  });

  it("round-trip: set → get aynı değeri döndürür", async () => {
    // Gerçek storage simülasyonu: in-memory store.
    //
    // setAdminCredentials iki UPSERT çağrısı yapar; key'i de parametre olarak
    // geçirir. postgres.js tagged template'de:
    //   sql`INSERT ... VALUES (${key}, ${value}) ...`
    //   → args[0] = template string array
    //   → args[1] = key, args[2] = value
    //
    // Aynı INSERT formatı getAutoStartDatabases / setAutoStart'ta da kullanılır;
    // bu test sadece admin_email ve admin_password_hash key'lerini store'a yazar.
    const store = new Map<string, string>();

    const sql = vi.fn((...args: unknown[]) => {
      const templateParts = args[0] as string[];
      const q = templateParts.join("_PARAM_");

      if (q.includes("CREATE TABLE IF NOT EXISTS")) return Promise.resolve([]);

      if (q.includes("SELECT key, value FROM _postgrify_settings")) {
        const rows = [...store.entries()].map(([k, v]) => ({ key: k, value: v }));
        return Promise.resolve(rows);
      }

      if (q.includes("INSERT INTO _postgrify_settings")) {
        // VALUES (${key}, ${value}) → args[1]=key, args[2]=value
        const key = args[1] as string;
        const value = args[2] as string;
        if (key && value !== undefined) store.set(key, value);
        return Promise.resolve([]);
      }
      return Promise.resolve([]);
    }) as unknown as import("postgres").Sql;

    const svc = new SettingsService(sql);
    await svc.setAdminCredentials("admin@roundtrip.com", "$argon2id$roundtrip");
    const creds: AdminCredentials | null = await svc.getAdminCredentials();

    expect(creds?.email).toBe("admin@roundtrip.com");
    expect(creds?.passwordHash).toBe("$argon2id$roundtrip");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Admin setup flag
// ─────────────────────────────────────────────────────────────────────────────

describe("getAdminSetupCompleted", () => {
  it("'true' değeri varsa true döner", async () => {
    const store = new Map([["admin_setup_completed", "true"]]);
    const sql = vi.fn((...args: unknown[]) => {
      const q = String(args[0]);
      if (q.includes("CREATE TABLE IF NOT EXISTS")) return Promise.resolve([]);
      if (q.includes("SELECT value FROM _postgrify_settings")) {
        const key = extractWhereKey(q);
        const val = store.get(key);
        return Promise.resolve(val ? [{ value: val }] : []);
      }
      return Promise.resolve([]);
    }) as unknown as import("postgres").Sql;

    const svc = new SettingsService(sql);
    expect(await svc.getAdminSetupCompleted()).toBe(true);
  });

  it("kayıt yoksa false döner", async () => {
    const { sql } = makeSqlMock([]);
    const svc = new SettingsService(sql);
    expect(await svc.getAdminSetupCompleted()).toBe(false);
  });

  it("değer 'false' ise false döner", async () => {
    const { sql } = makeSqlMock([{ key: "admin_setup_completed", value: "false" }]);
    const svc = new SettingsService(sql);
    expect(await svc.getAdminSetupCompleted()).toBe(false);
  });
});

describe("setAdminSetupCompleted", () => {
  it("INSERT çağrısı yapılır", async () => {
    let inserted = false;
    const sql = vi.fn((...args: unknown[]) => {
      const q = String(args[0]);
      if (q.includes("CREATE TABLE IF NOT EXISTS")) return Promise.resolve([]);
      if (q.includes("INSERT INTO _postgrify_settings")) {
        inserted = true;
        return Promise.resolve([]);
      }
      return Promise.resolve([]);
    }) as unknown as import("postgres").Sql;

    const svc = new SettingsService(sql);
    await svc.setAdminSetupCompleted();
    expect(inserted).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Auto-start databases
// ─────────────────────────────────────────────────────────────────────────────

describe("getAutoStartDatabases", () => {
  it("boş listede boş dizi döner", async () => {
    const { sql } = makeSqlMock([]);
    const svc = new SettingsService(sql);
    expect(await svc.getAutoStartDatabases()).toEqual([]);
  });

  it("kayıtlı liste döner", async () => {
    const { sql } = makeSqlMock([
      { key: "autoStartDatabases", value: '["mydb","otherdb"]' },
    ]);
    const svc = new SettingsService(sql);
    expect(await svc.getAutoStartDatabases()).toEqual(["mydb", "otherdb"]);
  });

  it("bozuk JSON için boş dizi döner (graceful)", async () => {
    const { sql } = makeSqlMock([
      { key: "autoStartDatabases", value: "not-json" },
    ]);
    const svc = new SettingsService(sql);
    expect(await svc.getAutoStartDatabases()).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Provision (tablo oluşturma)
// ─────────────────────────────────────────────────────────────────────────────

describe("ensureReady (provision)", () => {
  it("ilk çağrıda CREATE TABLE çalıştırılır", async () => {
    let createTableCalled = false;
    const sql = vi.fn((...args: unknown[]) => {
      const q = String(args[0]);
      if (q.includes("CREATE TABLE IF NOT EXISTS")) {
        createTableCalled = true;
        return Promise.resolve([]);
      }
      return Promise.resolve([]);
    }) as unknown as import("postgres").Sql;

    const svc = new SettingsService(sql);
    await svc.getAdminSetupCompleted();
    expect(createTableCalled).toBe(true);
  });

  it("ikinci çağrıda CREATE TABLE tekrar çalıştırılmaz (önbellek)", async () => {
    let createCount = 0;
    const sql = vi.fn((...args: unknown[]) => {
      const q = String(args[0]);
      if (q.includes("CREATE TABLE IF NOT EXISTS")) {
        createCount++;
        return Promise.resolve([]);
      }
      return Promise.resolve([]);
    }) as unknown as import("postgres").Sql;

    const svc = new SettingsService(sql);
    await svc.getAdminSetupCompleted();
    await svc.getAdminSetupCompleted();
    expect(createCount).toBe(1);
  });

  it("provision başarısız olursa bir sonraki çağrıda retry edilir", async () => {
    let callCount = 0;
    const sql = vi.fn((...args: unknown[]) => {
      const q = String(args[0]);
      if (q.includes("CREATE TABLE IF NOT EXISTS")) {
        callCount++;
        if (callCount === 1) return Promise.reject(new Error("DB unavailable"));
        return Promise.resolve([]);
      }
      return Promise.resolve([]);
    }) as unknown as import("postgres").Sql;

    const svc = new SettingsService(sql);

    // İlk çağrı başarısız
    await expect(svc.getAdminSetupCompleted()).rejects.toThrow("DB unavailable");
    // İkinci çağrı başarılı (retry)
    await expect(svc.getAdminSetupCompleted()).resolves.toBe(false);
    expect(callCount).toBe(2);
  });
});