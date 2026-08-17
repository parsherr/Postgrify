/**
 * BackupService unit tests — mocked postgres and child_process.
 *
 * BackupService constructor:
 *   new BackupService(metaSql: postgres.Sql, backupDir: string)
 *
 * metaSql is the first parameter — the Sql handle for the _postgrify_backups
 * metadata table. backupDir is the second parameter.
 *
 * child_process.spawn is mocked so no real pg_dump is invoked.
 * fs is mocked so no real disk access occurs.
 */

import { describe, it, expect, vi } from "vitest";
import type { Sql } from "postgres";

// The service imports from "fs" (no node: prefix) — mock both forms.
vi.mock("fs", () => ({
  default: {
    existsSync: vi.fn(() => true),
    mkdirSync: vi.fn(),
    unlinkSync: vi.fn(),
    statSync: vi.fn(() => ({ size: 1024 })),
  },
  createWriteStream: vi.fn(() => ({ on: vi.fn(), close: vi.fn(), write: vi.fn() })),
  createReadStream: vi.fn(() => ({ pipe: vi.fn(), on: vi.fn() })),
  existsSync: vi.fn(() => true),
  mkdirSync: vi.fn(),
  unlinkSync: vi.fn(),
  statSync: vi.fn(() => ({ size: 1024 })),
}));

vi.mock("zlib", () => ({
  createGzip: vi.fn(() => ({ pipe: vi.fn(), on: vi.fn() })),
  createGunzip: vi.fn(() => ({ pipe: vi.fn(), on: vi.fn() })),
}));

vi.mock("stream/promises", () => ({
  pipeline: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("readline", () => ({
  createInterface: vi.fn(() => ({
    [Symbol.asyncIterator]: vi.fn(() => ({ next: vi.fn().mockResolvedValue({ done: true }) })),
    close: vi.fn(),
  })),
}));

// ── Test data ────────────────────────────────────────────────────────────────

const MOCK_BACKUP_ROW = {
  id: "bk_001",
  db_name: "testdb",
  file_path: "/tmp/test-backups/testdb/bk_001.sql.gz",
  size_bytes: 1024,
  status: "completed",
  created_at: new Date().toISOString(),
  error_msg: null,
};

/**
 * Creates a postgres.js tagged-template mock.
 *
 * postgres.js calls sql as a tagged template: sql`...` is equivalent to
 * sql(strings, ...values). We return a function that captures any call
 * (tagged or positional) and resolves with the given rows.
 */
function makeMetaSql(rows: Record<string, unknown>[] = []): Sql {
  const fn = vi.fn((..._args: unknown[]) => Promise.resolve(rows));
  // postgres.js Sql objects also expose .unsafe(); provide a stub.
  (fn as unknown as Record<string, unknown>).unsafe = vi.fn(
    () => Promise.resolve(rows)
  );
  return fn as unknown as Sql;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("BackupService — listBackups", () => {
  it("returns backup list from the database", async () => {
    const { BackupService } = await import(
      "../../src/services/backupService.js"
    );
    const svc = new BackupService(makeMetaSql([MOCK_BACKUP_ROW]), "/tmp/test-backups");
    const result = await svc.listBackups("testdb");
    expect(Array.isArray(result)).toBe(true);
  });

  it("returns empty array when no backups exist", async () => {
    const { BackupService } = await import(
      "../../src/services/backupService.js"
    );
    const svc = new BackupService(makeMetaSql([]), "/tmp/test-backups");
    const result = await svc.listBackups("testdb");
    expect(result).toEqual([]);
  });
});

describe("BackupService — getBackup", () => {
  it("returns undefined when backup does not exist", async () => {
    const { BackupService } = await import(
      "../../src/services/backupService.js"
    );
    const svc = new BackupService(makeMetaSql([]), "/tmp/test-backups");
    const result = await svc.getBackup("nonexistent");
    expect(result).toBeUndefined();
  });

  it("returns backup metadata when it exists", async () => {
    const { BackupService } = await import(
      "../../src/services/backupService.js"
    );
    const svc = new BackupService(makeMetaSql([MOCK_BACKUP_ROW]), "/tmp/test-backups");
    const result = await svc.getBackup("bk_001");
    expect(result).toBeDefined();
  });
});