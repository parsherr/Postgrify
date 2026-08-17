/**
 * Backup routes — /db/:database/backup/*
 *
 * Endpoints:
 *   GET    /:database/backup/download               — Live streaming SQL dump (gzip)
 *   GET    /:database/backup/list                   — List saved backups
 *   POST   /:database/backup/create                 — Trigger a manual backup
 *   GET    /:database/backup/:backupId/download     — Download a saved backup
 *   DELETE /:database/backup/:backupId              — Delete a saved backup
 *   POST   /:database/backup/restore                — Upload + restore a backup file
 *   GET    /:database/backup/schedule               — Current schedule configuration
 *   PUT    /:database/backup/schedule               — Save / update a schedule
 *   DELETE /:database/backup/schedule               — Cancel a schedule
 *
 * All endpoints require "schema" scope.
 * Restore: gzip decompress → split into statements → execute inside a transaction.
 * Streaming download: file is read and piped to the response.
 */

import { createGzip } from "zlib";
import { pipeline } from "stream/promises";
import { Readable } from "stream";
import { statSync } from "fs";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { scopeGuard } from "../../middleware/scopeGuard.js";
import { config } from "../../config/env.js";

const MAX_UPLOAD_BYTES = config.BACKUP_MAX_SIZE_MB * 1024 * 1024;

export async function backupRoute(server: FastifyInstance) {
  // ── GET /:database/backup/download ────────────────────────────────────────
  // Live streaming gzip SQL dump — not saved to disk, written directly to the response.
  server.get(
    "/:database/backup/download",
    {
      preHandler: [scopeGuard("schema")],
      schema: {
        description: "Stream a live SQL backup of the database (gzip compressed)",
        tags: ["backup"],
        params: {
          type: "object",
          properties: { database: { type: "string" } },
        },
      },
    },
    asyncHandler(async (req: FastifyRequest, reply: FastifyReply) => {
      const dbName = req.dbName!;
      const sql = server.poolManager.getPool(dbName);

      const now = new Date().toISOString();
      const dateTag = now.slice(0, 10).replace(/-/g, "");
      const filename = `${dbName}_${dateTag}.sql.gz`;

      reply
        .header("Content-Type", "application/gzip")
        .header("Content-Disposition", `attachment; filename="${filename}"`)
        .header("Transfer-Encoding", "chunked");

      // Instead of using BackupService.buildDump as an internal method,
      // we create a temporary file via createBackup and pipe it —
      // but for streaming we write directly to the response.
      // For this we call a public stream helper rather than the private buildDump method.
      //
      // For simplicity: generate the dump string and pipe through gzip.
      // For large DBs, backupService.createBackup is preferred.
      const result = await server.backupService.createBackup(dbName, sql);

      if (result.status === "failed") {
        return reply.status(500).send({ error: result.error_msg ?? "Backup failed" });
      }

      // Pipe the resulting file to the response
      reply.raw.setHeader("Content-Type", "application/gzip");
      reply.raw.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

      await server.backupService.streamBackupToResponse(result.file_path, reply.raw);
    })
  );

  // ── GET /:database/backup/list ────────────────────────────────────────────
  server.get(
    "/:database/backup/list",
    {
      preHandler: [scopeGuard("schema")],
      schema: {
        description: "List saved backups for a database",
        tags: ["backup"],
        params: {
          type: "object",
          properties: { database: { type: "string" } },
        },
        response: {
          200: {
            type: "object",
            properties: {
              backups: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    id:         { type: "string" },
                    db_name:    { type: "string" },
                    file_path:  { type: "string" },
                    size_bytes: { type: ["number", "null"] },
                    status:     { type: "string" },
                    created_at: { type: "string" },
                    error_msg:  { type: ["string", "null"] },
                  },
                },
              },
            },
          },
        },
      },
    },
    asyncHandler(async (req: FastifyRequest, reply: FastifyReply) => {
      const dbName = req.dbName!;
      const backups = await server.backupService.listBackups(dbName);
      return reply.send({ backups });
    })
  );

  // ── POST /:database/backup/create ─────────────────────────────────────────
  server.post(
    "/:database/backup/create",
    {
      preHandler: [scopeGuard("schema")],
      schema: {
        description: "Trigger a manual backup for a database",
        tags: ["backup"],
        params: {
          type: "object",
          properties: { database: { type: "string" } },
        },
        response: {
          201: {
            type: "object",
            properties: {
              id:         { type: "string" },
              db_name:    { type: "string" },
              file_path:  { type: "string" },
              size_bytes: { type: ["number", "null"] },
              status:     { type: "string" },
              created_at: { type: "string" },
              error_msg:  { type: ["string", "null"] },
            },
          },
        },
      },
    },
    asyncHandler(async (req: FastifyRequest, reply: FastifyReply) => {
      const dbName = req.dbName!;
      const sql = server.poolManager.getPool(dbName);

      const result = await server.backupService.createBackup(dbName, sql);

      if (result.status === "failed") {
        return reply.status(500).send({ error: result.error_msg ?? "Backup failed" });
      }

      // Apply retention policy if configured
      const schedule = await server.settings.getBackupSchedule(dbName);
      if (schedule && schedule.retain > 0) {
        await server.backupService.enforceRetention(dbName, schedule.retain);
      }

      return reply.status(201).send(result);
    })
  );

  // ── GET /:database/backup/:backupId/download ──────────────────────────────
  server.get(
    "/:database/backup/:backupId/download",
    {
      preHandler: [scopeGuard("schema")],
      schema: {
        description: "Download a specific saved backup",
        tags: ["backup"],
        params: {
          type: "object",
          properties: {
            database: { type: "string" },
            backupId: { type: "string" },
          },
        },
      },
    },
    asyncHandler(async (req: FastifyRequest, reply: FastifyReply) => {
      const dbName = req.dbName!;
      const { backupId } = req.params as { backupId: string };

      const meta = await server.backupService.getBackup(backupId);

      if (!meta || meta.db_name !== dbName) {
        return reply.status(404).send({ error: "Backup not found" });
      }

      if (meta.status !== "completed") {
        return reply.status(409).send({ error: `Backup status is "${meta.status}", cannot download` });
      }

      let fileSize: number | null = null;
      try {
        fileSize = statSync(meta.file_path).size;
      } catch {
        return reply.status(404).send({ error: "Backup file missing from disk" });
      }

      const filename = meta.file_path.split("/").pop() ?? `${dbName}_${backupId}.sql.gz`;

      reply.raw.setHeader("Content-Type", "application/gzip");
      reply.raw.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      if (fileSize) reply.raw.setHeader("Content-Length", String(fileSize));

      await server.backupService.streamBackupToResponse(meta.file_path, reply.raw);
    })
  );

  // ── DELETE /:database/backup/:backupId ────────────────────────────────────
  server.delete(
    "/:database/backup/:backupId",
    {
      preHandler: [scopeGuard("schema")],
      schema: {
        description: "Delete a saved backup (metadata + file)",
        tags: ["backup"],
        params: {
          type: "object",
          properties: {
            database: { type: "string" },
            backupId: { type: "string" },
          },
        },
      },
    },
    asyncHandler(async (req: FastifyRequest, reply: FastifyReply) => {
      const dbName = req.dbName!;
      const { backupId } = req.params as { backupId: string };

      const meta = await server.backupService.getBackup(backupId);

      if (!meta || meta.db_name !== dbName) {
        return reply.status(404).send({ error: "Backup not found" });
      }

      await server.backupService.deleteBackup(backupId);
      return reply.status(204).send();
    })
  );

  // ── POST /:database/backup/restore ────────────────────────────────────────
  // A .sql.gz file is uploaded via multipart, parsed, and restored.
  server.post(
    "/:database/backup/restore",
    {
      preHandler: [scopeGuard("schema")],
      schema: {
        description: "Restore a database from an uploaded .sql.gz backup file",
        tags: ["backup"],
        params: {
          type: "object",
          properties: { database: { type: "string" } },
        },
        consumes: ["multipart/form-data"],
      },
    },
    asyncHandler(async (req: FastifyRequest, reply: FastifyReply) => {
      const dbName = req.dbName!;

      // Read the file via @fastify/multipart
      let fileData: Buffer | null = null;

      try {
        const data = await req.file({ limits: { fileSize: MAX_UPLOAD_BYTES } });
        if (!data) {
          return reply.status(400).send({ error: "No file uploaded" });
        }

        const chunks: Buffer[] = [];
        for await (const chunk of data.file) {
          chunks.push(chunk);
        }
        fileData = Buffer.concat(chunks);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("Request file too large")) {
          return reply.status(413).send({
            error: `File exceeds maximum size of ${config.BACKUP_MAX_SIZE_MB} MB`,
          });
        }
        throw err;
      }

      if (!fileData || fileData.length === 0) {
        return reply.status(400).send({ error: "Uploaded file is empty" });
      }

      // Write to a temporary file — backupService.restoreBackup expects a file path
      const { writeFileSync, unlinkSync, mkdtempSync } = await import("fs");
      const { join } = await import("path");
      const { tmpdir } = await import("os");

      const tmpDir = mkdtempSync(join(tmpdir(), "postgrify-restore-"));
      const tmpFile = join(tmpDir, "restore.sql.gz");

      try {
        writeFileSync(tmpFile, fileData);
        const sql = server.poolManager.getPool(dbName);
        await server.backupService.restoreBackup(sql, tmpFile);
      } finally {
        try { unlinkSync(tmpFile); } catch { /* clean up temporary file */ }
        try { (await import("fs")).rmdirSync(tmpDir); } catch { /* clean up temporary directory */ }
      }

      return reply.send({ restored: true, database: dbName });
    })
  );

  // ── GET /:database/backup/schedule ────────────────────────────────────────
  server.get(
    "/:database/backup/schedule",
    {
      preHandler: [scopeGuard("schema")],
      schema: {
        description: "Get the backup schedule for a database",
        tags: ["backup"],
        params: {
          type: "object",
          properties: { database: { type: "string" } },
        },
        response: {
          200: {
            type: "object",
            properties: {
              database: { type: "string" },
              schedule: {
                type: ["object", "null"],
                properties: {
                  cron:    { type: "string" },
                  enabled: { type: "boolean" },
                  retain:  { type: "number" },
                },
              },
            },
          },
        },
      },
    },
    asyncHandler(async (req: FastifyRequest, reply: FastifyReply) => {
      const dbName = req.dbName!;
      const schedule = await server.settings.getBackupSchedule(dbName);
      return reply.send({ database: dbName, schedule });
    })
  );

  // ── PUT /:database/backup/schedule ────────────────────────────────────────
  server.put(
    "/:database/backup/schedule",
    {
      preHandler: [scopeGuard("schema")],
      schema: {
        description: "Create or update the backup schedule for a database",
        tags: ["backup"],
        params: {
          type: "object",
          properties: { database: { type: "string" } },
        },
        body: {
          type: "object",
          required: ["cron", "enabled", "retain"],
          properties: {
            cron:    { type: "string", description: "Cron expression (5 fields)" },
            enabled: { type: "boolean" },
            retain:  { type: "number", minimum: 1, maximum: 100 },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              database: { type: "string" },
              schedule: {
                type: "object",
                properties: {
                  cron:    { type: "string" },
                  enabled: { type: "boolean" },
                  retain:  { type: "number" },
                },
              },
            },
          },
        },
      },
    },
    asyncHandler(async (req: FastifyRequest, reply: FastifyReply) => {
      const dbName = req.dbName!;
      const body = req.body as { cron: string; enabled: boolean; retain: number };

      // Validate the cron expression
      const cron = await import("node-cron");
      if (!cron.validate(body.cron)) {
        return reply.status(400).send({ error: `Invalid cron expression: "${body.cron}"` });
      }

      const scheduleConfig = { cron: body.cron, enabled: body.enabled, retain: body.retain };

      // Save to DB
      await server.settings.setBackupSchedule(dbName, scheduleConfig);

      // Update the scheduler (activates/deactivates immediately at runtime)
      if (body.enabled) {
        server.backupScheduler.scheduleBackup(dbName, scheduleConfig);
      } else {
        server.backupScheduler.cancelSchedule(dbName);
      }

      return reply.send({ database: dbName, schedule: scheduleConfig });
    })
  );

  // ── DELETE /:database/backup/schedule ─────────────────────────────────────
  server.delete(
    "/:database/backup/schedule",
    {
      preHandler: [scopeGuard("schema")],
      schema: {
        description: "Cancel and remove the backup schedule for a database",
        tags: ["backup"],
        params: {
          type: "object",
          properties: { database: { type: "string" } },
        },
      },
    },
    asyncHandler(async (req: FastifyRequest, reply: FastifyReply) => {
      const dbName = req.dbName!;

      await server.settings.deleteBackupSchedule(dbName);
      server.backupScheduler.cancelSchedule(dbName);

      return reply.status(204).send();
    })
  );
}