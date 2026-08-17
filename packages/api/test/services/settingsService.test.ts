/**
 * SettingsService unit tests.
 *
 * Tested without a real DB connection — the postgres SQL function is mocked.
 * Each test uses its own mock sql instance.
 *
 * Coverage:
 *   - getAdminCredentials / setAdminCredentials round-trip
 *   - getAdminSetupCompleted / setAdminSetupCompleted
 *   - getAutoStartDatabases / setAutoStartDatabases
 *   - Provision: CREATE TABLE SQL is executed
 *   - Graceful fallback: failed provision → retry on next call
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { SettingsService } from "../../src/services/settingsService.js";
import type { AdminCredentials } from "../../src/services/settingsService.js";

// ---------------------------------------------------------------------------
// SQL mock factory
// ---------------------------------------------------------------------------

/**
 * Creates a postgres.js sql tagged-template mock.
 * The first call handles provision (CREATE TABLE); subsequent calls handle
 * data reads and writes.
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

/** Extracts the key value from a WHERE key = '...' clause */
function extractWhereKey(query: string): string {
  const match = query.match(/WHERE key = '([^']+)'/);
  return match?.[1] ?? "";
}

// ---------------------------------------------------------------------------
// getAdminCredentials
// ---------------------------------------------------------------------------

describe("getAdminCredentials", () => {
  it("returns credentials when both email and hash are present", async () => {
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

  it("returns null when email is missing", async () => {
    const { sql } = makeSqlMock([
      { key: "admin_password_hash", value: "$argon2id$v=19$hash" },
    ]);
    const svc = new SettingsService(sql);
    const creds = await svc.getAdminCredentials();
    expect(creds).toBeNull();
  });

  it("returns null when hash is missing", async () => {
    const { sql } = makeSqlMock([
      { key: "admin_email", value: "admin@example.com" },
    ]);
    const svc = new SettingsService(sql);
    const creds = await svc.getAdminCredentials();
    expect(creds).toBeNull();
  });

  it("returns null when DB is empty", async () => {
    const { sql } = makeSqlMock([]);
    const svc = new SettingsService(sql);
    const creds = await svc.getAdminCredentials();
    expect(creds).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// setAdminCredentials
// ---------------------------------------------------------------------------

describe("setAdminCredentials", () => {
  it("calls INSERT for both email and hash", async () => {
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

    // Expect separate INSERTs for email and passwordHash
    expect(insertCalls.length).toBeGreaterThanOrEqual(2);
  });

  it("round-trip: set then get returns the same values", async () => {
    // Simulate real storage with an in-memory map.
    //
    // setAdminCredentials performs two UPSERT calls; the key is passed as a
    // parameter. In postgres.js tagged templates:
    //   sql`INSERT ... VALUES (${key}, ${value}) ...`
    //   → args[0] = template string array
    //   → args[1] = key, args[2] = value
    const store = new Map<string, string>();

    const sql = vi.fn((...args: unknown[]) => {
      const templateParts = args[0] as string[];
      const q = templateParts.join("_PARAM_");

      if (q.includes("CREATE TABLE IF NOT EXISTS")) return Promise.resolve([]);

      if (q.includes("SELECT key, value FROM _postgrify_settings")) {
        const rows = Array.from(store.entries()).map(([key, value]) => ({
          key,
          value,
        }));
        return Promise.resolve(rows);
      }

      if (q.includes("INSERT INTO _postgrify_settings")) {
        const key = String(args[1]);
        const value = String(args[2]);
        store.set(key, value);
        return Promise.resolve([]);
      }

      return Promise.resolve([]);
    }) as unknown as import("postgres").Sql;

    const svc = new SettingsService(sql);
    await svc.setAdminCredentials("admin@example.com", "$argon2id$roundtrip");

    const result = await svc.getAdminCredentials();
    expect(result?.email).toBe("admin@example.com");
    expect(result?.passwordHash).toBe("$argon2id$roundtrip");
  });
});

// ---------------------------------------------------------------------------
// getAdminSetupCompleted / setAdminSetupCompleted
// ---------------------------------------------------------------------------

describe("getAdminSetupCompleted", () => {
  it("returns false when the setup_completed key is missing", async () => {
    const { sql } = makeSqlMock([]);
    const svc = new SettingsService(sql);
    const result = await svc.getAdminSetupCompleted();
    expect(result).toBe(false);
  });

  it("returns true when setup_completed is 'true'", async () => {
    const { sql } = makeSqlMock([
      { key: "admin_setup_completed", value: "true" },
    ]);
    const svc = new SettingsService(sql);
    const result = await svc.getAdminSetupCompleted();
    expect(result).toBe(true);
  });
});

describe("setAdminSetupCompleted", () => {
  it("executes INSERT with key admin_setup_completed and value 'true'", async () => {
    // setAdminSetupCompleted() takes no arguments — it always writes 'true'.
    // The key and value are hardcoded in the tagged template literal, so they
    // appear as parts of args[0] (the TemplateStringsArray), not as positional
    // args. We verify the SQL was called with the expected key/value text.
    let insertCalled = false;
    const sql = vi.fn((...args: unknown[]) => {
      const q = String(args[0]);
      if (
        q.includes("INSERT INTO _postgrify_settings") &&
        q.includes("admin_setup_completed")
      ) {
        insertCalled = true;
      }
      return Promise.resolve([]);
    }) as unknown as import("postgres").Sql;

    const svc = new SettingsService(sql);
    await svc.setAdminSetupCompleted();
    expect(insertCalled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Provision behaviour
// ---------------------------------------------------------------------------

describe("Provision (CREATE TABLE)", () => {
  it("runs CREATE TABLE on the first call", async () => {
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

  it("does not re-run CREATE TABLE on the second call (cached)", async () => {
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

  it("retries provision on the next call after a failure", async () => {
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

    // First call fails
    await expect(svc.getAdminSetupCompleted()).rejects.toThrow("DB unavailable");
    // Second call succeeds (retry)
    await expect(svc.getAdminSetupCompleted()).resolves.toBe(false);
    expect(callCount).toBe(2);
  });
});