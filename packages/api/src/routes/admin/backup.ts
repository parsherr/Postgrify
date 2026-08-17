/**
 * Admin backup routes — /admin/backup/*
 *
 * Endpoints:
 *   GET  /admin/backup/overview — Latest backup status for all DBs + active schedule count
 *   POST /admin/backup/run-all  — Trigger an immediate backup for all DBs with an active schedule
 *
 * Requires admin token (authenticateAdmin preHandler applied at route group level).
 */

import type { FastifyInstance } from "fastify";
import { asyncHandler } from "../../utils/asyncHandler.js";

export async function adminBackupRoute(server: FastifyInstance) {
  // GET /admin/backup/overview
  server.get(
    "/backup/overview",
    {
      schema: {
        description: "Overview of backup status for all databases",
        tags: ["admin"],
        response: {
          200: {
            type: "object",
            properties: {
              activeSchedules: { type: "number" },
              scheduledDatabases: {
                type: "array",
                items: { type: "string" },
              },
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
    asyncHandler(async (_req, reply) => {
      const backups = await server.backupService.listAllBackups();
      const scheduledDatabases = server.backupScheduler.activeSchedules();

      return reply.send({
        activeSchedules: scheduledDatabases.length,
        scheduledDatabases,
        backups,
      });
    })
  );

  // POST /admin/backup/run-all
  server.post(
    "/backup/run-all",
    {
      schema: {
        description: "Trigger an immediate backup for all databases that have an active schedule",
        tags: ["admin"],
        response: {
          202: {
            type: "object",
            properties: {
              triggered: { type: "number" },
              databases: {
                type: "array",
                items: { type: "string" },
              },
            },
          },
        },
      },
    },
    asyncHandler(async (_req, reply) => {
      const scheduledDbs = server.backupScheduler.activeSchedules();

      // Start in background — we do not await the results (202 Accepted)
      for (const dbName of scheduledDbs) {
        const sql = server.poolManager.getPool(dbName);
        server.backupService
          .createBackup(dbName, sql)
          .then(async (result) => {
            if (result.status === "completed") {
              const schedule = await server.settings.getBackupSchedule(dbName);
              if (schedule && schedule.retain > 0) {
                await server.backupService.enforceRetention(dbName, schedule.retain);
              }
            }
          })
          .catch((err: unknown) => {
            server.log.error({ err, dbName }, "run-all backup failed");
          });
      }

      return reply.status(202).send({
        triggered: scheduledDbs.length,
        databases: scheduledDbs,
      });
    })
  );
}