/**
 * Backup route tests.
 *
 * Strategy: BackupService and BackupScheduler are mocked; only the HTTP layer
 * and route handler logic is tested. No real filesystem or DB connection required.
 *
 * Endpoints covered:
 *   GET    /db/:database/backup/list
 *   POST   /db/:database/backup/create
 *   GET    /db/:database/backup/:backupId/download
 *   DELETE /db/:database/backup/:backupId
 *   POST   /db/:database/backup/restore
 *   GET    /db/:database/backup/schedule
 *   PUT    /db/:database/backup/schedule
 *   DELETE /db/:database/backup/schedule
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { backupRoute } from "../../src/routes/db/backup.js";

// ---------------------------------------------------------------------------
// Mock types
// ---------------------------------------------------------------------------

const SAMPLE_BACKUP = {
  id: "abc-123",
  db_name: "testdb",
  file_path: "/data/backups/testdb/testdb_20240101T020000_abc123.sql.gz",
  size_bytes: 1024,
  status: "completed" as const,
  created_at: "2024-01-01T02:00:00.000Z",
  error_msg: null,
};

const SAMPLE_SCHEDULE = {
  cron: "0 2 * * *",
  enabled: true,
  retain: 7,
};

// ---------------------------------------------------------------------------
// Mock service factories
// ---------------------------------------------------------------------------

function makeBackupServiceMock() {
  return {
    listBackups: vi.fn().mockResolvedValue([SAMPLE_BACKUP]),
    createBackup: vi.fn().mockResolvedValue(SAMPLE_BACKUP),
    getBackup: vi.fn().mockResolvedValue(SAMPLE_BACKUP),
    deleteBackup: vi.fn().mockResolvedValue(undefined),
    restoreBackup: vi.fn().mockResolvedValue(undefined),
    streamBackupToResponse: vi.fn().mockImplementation(async (_path, stream) => {
      stream.raw.end("fake-data");
    }),
    enforceRetention: vi.fn().mockResolvedValue(undefined),
    cleanMetaForDatabase: vi.fn().mockResolvedValue(undefined),
  };
}

function makeSchedulerMock() {
  return {
    scheduleBackup: vi.fn(),
    cancelSchedule: vi.fn(),
    activeSchedules: vi.fn().mockReturnValue([]),
    load: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn(),
  };
}

function makeSettingsMock() {
  return {
    getBackupSchedule: vi.fn().mockResolvedValue(SAMPLE_SCHEDULE),
    setBackupSchedule: vi.fn().mockResolvedValue(undefined),
    deleteBackupSchedule: vi.fn().mockResolvedValue(undefined),
  };
}

// ---------------------------------------------------------------------------
// Test server factory
// ---------------------------------------------------------------------------

async function buildServer() {
  const app = Fastify({ logger: false });

  const backupService = makeBackupServiceMock();
  const scheduler = makeSchedulerMock();
  const settings = makeSettingsMock();

  // Decorate with mocked services
  app.decorate("backupService", backupService);
  app.decorate("backupScheduler", scheduler);
  app.decorate("settings", settings);
  app.decorate("poolManager", { getPool: vi.fn().mockReturnValue({}) });

  // Decorate request fields expected by scopeGuard + dbResolver
  app.decorateRequest("user",   null);
  app.decorateRequest("dbName", "");

  // Mock auth + dbResolver: set req.user (what scopeGuard reads) and req.dbName
  app.addHook("onRequest", async (req) => {
    (req as unknown as Record<string, unknown>).dbName = "testdb";
    // role:"admin" bypasses scope check in scopeGuard entirely
    (req as unknown as Record<string, unknown>).user = {
      sub:   "testdb",
      role:  "admin",
      scope: ["schema"],
      type:  "db",
    };
  });

  // Mock authenticate — req.user is already set above via onRequest
  app.decorate("authenticate", async () => {});

  // Register multipart plugin mock
  app.decorateRequest("file", async () => null);

  await app.register(backupRoute);
  await app.ready();

  return { app, backupService, scheduler, settings };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GET /backup/list", () => {
  it("returns backup list", async () => {
    const { app, backupService } = await buildServer();

    const res = await app.inject({
      method: "GET",
      url: "/testdb/backup/list",
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ backups: typeof SAMPLE_BACKUP[] }>();
    expect(body.backups).toHaveLength(1);
    expect(body.backups[0].id).toBe("abc-123");
    expect(backupService.listBackups).toHaveBeenCalledWith("testdb");

    await app.close();
  });
});

describe("POST /backup/create", () => {
  it("creates a backup and returns metadata", async () => {
    const { app, backupService } = await buildServer();

    const res = await app.inject({
      method: "POST",
      url: "/testdb/backup/create",
    });

    expect(res.statusCode).toBe(201);
    const body = res.json<typeof SAMPLE_BACKUP>();
    expect(body.id).toBe("abc-123");
    expect(body.status).toBe("completed");
    expect(backupService.createBackup).toHaveBeenCalledWith("testdb", expect.anything());

    await app.close();
  });

  it("returns 500 when backup service throws", async () => {
    const { app, backupService } = await buildServer();
    backupService.createBackup.mockRejectedValueOnce(new Error("disk full"));

    const res = await app.inject({
      method: "POST",
      url: "/testdb/backup/create",
    });

    expect(res.statusCode).toBe(500);
    await app.close();
  });
});

describe("DELETE /backup/:backupId", () => {
  it("deletes a backup and returns 204", async () => {
    const { app, backupService } = await buildServer();

    const res = await app.inject({
      method: "DELETE",
      url: "/testdb/backup/abc-123",
    });

    expect(res.statusCode).toBe(204);
    expect(backupService.deleteBackup).toHaveBeenCalledWith("abc-123");

    await app.close();
  });

  it("returns 404 when backup not found", async () => {
    const { app, backupService } = await buildServer();
    backupService.getBackup.mockResolvedValueOnce(null);

    const res = await app.inject({
      method: "DELETE",
      url: "/testdb/backup/nonexistent",
    });

    expect(res.statusCode).toBe(404);
    await app.close();
  });
});

describe("GET /backup/schedule", () => {
  it("returns current schedule", async () => {
    const { app, settings } = await buildServer();

    const res = await app.inject({
      method: "GET",
      url: "/testdb/backup/schedule",
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ database: string; schedule: typeof SAMPLE_SCHEDULE | null }>();
    expect(body.database).toBe("testdb");
    expect(body.schedule?.cron).toBe("0 2 * * *");
    expect(settings.getBackupSchedule).toHaveBeenCalledWith("testdb");

    await app.close();
  });

  it("returns null schedule when none is configured", async () => {
    const { app, settings } = await buildServer();
    settings.getBackupSchedule.mockResolvedValueOnce(null);

    const res = await app.inject({
      method: "GET",
      url: "/testdb/backup/schedule",
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ database: string; schedule: null }>();
    expect(body.schedule).toBeNull();

    await app.close();
  });
});

describe("PUT /backup/schedule", () => {
  it("saves a valid schedule and updates the scheduler", async () => {
    const { app, settings, scheduler } = await buildServer();

    const payload = { cron: "0 3 * * *", enabled: true, retain: 5 };

    const res = await app.inject({
      method: "PUT",
      url: "/testdb/backup/schedule",
      payload,
    });

    expect(res.statusCode).toBe(200);
    expect(settings.setBackupSchedule).toHaveBeenCalledWith("testdb", payload);
    expect(scheduler.scheduleBackup).toHaveBeenCalledWith("testdb", payload);

    await app.close();
  });

  it("rejects an invalid cron expression with 400", async () => {
    const { app } = await buildServer();

    const res = await app.inject({
      method: "PUT",
      url: "/testdb/backup/schedule",
      payload: { cron: "invalid-cron", enabled: true, retain: 7 },
    });

    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("cancels the scheduler when enabled=false", async () => {
    const { app, scheduler } = await buildServer();

    const res = await app.inject({
      method: "PUT",
      url: "/testdb/backup/schedule",
      payload: { cron: "0 2 * * *", enabled: false, retain: 7 },
    });

    expect(res.statusCode).toBe(200);
    // enabled=false → cancelSchedule, not scheduleBackup
    expect(scheduler.cancelSchedule).toHaveBeenCalledWith("testdb");
    expect(scheduler.scheduleBackup).not.toHaveBeenCalled();

    await app.close();
  });
});

describe("DELETE /backup/schedule", () => {
  it("deletes schedule and cancels the cron job", async () => {
    const { app, settings, scheduler } = await buildServer();

    const res = await app.inject({
      method: "DELETE",
      url: "/testdb/backup/schedule",
    });

    expect(res.statusCode).toBe(204);
    expect(settings.deleteBackupSchedule).toHaveBeenCalledWith("testdb");
    expect(scheduler.cancelSchedule).toHaveBeenCalledWith("testdb");

    await app.close();
  });
});