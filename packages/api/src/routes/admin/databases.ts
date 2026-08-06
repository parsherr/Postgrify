/**
 * Admin DB yönetim route'ları:
 *   GET    /admin/databases                        — DB listesi + boyut + tablo sayısı + pool_active + auto_start
 *   POST   /admin/databases                        — Yeni DB oluştur
 *   DELETE /admin/databases/:db                    — DB sil (PostgreSQL seviyesinde DROP)
 *   POST   /admin/databases/:db/pool/stop          — Pool'u kapat (DB silinmez)
 *   POST   /admin/databases/:db/pool/start         — Pool'u başlat / yeniden bağlan
 *   PUT    /admin/databases/:db/settings           — auto_start ayarını güncelle
 */

import type { FastifyInstance } from "fastify";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { isValidIdentifier } from "../../utils/identifier.js";

export async function databasesRoute(server: FastifyInstance) {
  // GET /admin/databases
  server.get(
    "/databases",
    {
      schema: {
        description: "List all databases with size, table count and pool status",
        tags: ["admin"],
      },
    },
    asyncHandler(async (_req, reply) => {
      const sql = server.poolManager.getPool("postgres");

      const dbRows = await sql`
        SELECT
          d.datname AS name,
          pg_database_size(d.datname) AS size_bytes
        FROM pg_database d
        WHERE d.datistemplate = false
          AND d.datname != 'postgres'
        ORDER BY d.datname
      `;

      const activeNames = server.poolManager.activePoolNames;
      const autoStartDbs = await server.settings.getAutoStartDatabases();

      // Her DB için tablo sayısı — yalnızca zaten açık olan pool'ları kullan.
      // getPool() lazy init yapar, kapalı bir DB için çağırırsak pool yeniden
      // açılır; bu yüzden sadece activeNames'e dahil olanlara sorguyoruz.
      const databases = await Promise.all(
        dbRows.map(async (row) => {
          const name = row.name as string;
          const poolActive = activeNames.includes(name);
          let tableCount = 0;

          if (poolActive) {
            try {
              const dbSql = server.poolManager.getPool(name);
              const [countRow] = await dbSql`
                SELECT count(*) AS table_count
                FROM information_schema.tables
                WHERE table_schema = 'public'
                  AND table_type = 'BASE TABLE'
              `;
              tableCount = Number(countRow.table_count);
            } catch {
              // Bağlantı hatası — 0 döndür
            }
          }

          const startedAt = server.poolManager.getPoolStartedAt(name);
          return {
            name,
            size_bytes: Number(row.size_bytes),
            table_count: tableCount,
            pool_active: poolActive,
            pool_started_at: startedAt, // ms timestamp, null = kapalı
            auto_start: autoStartDbs.includes(name),
          };
        })
      );

      return reply.send({ databases });
    })
  );

  // POST /admin/databases/:db/pool/stop — pool'u kapat, DB silinmez
  server.post(
    "/databases/:db/pool/stop",
    {
      schema: {
        description: "Close the connection pool for a database without dropping it",
        tags: ["admin"],
        params: {
          type: "object",
          properties: { db: { type: "string" } },
        },
      },
    },
    asyncHandler(async (req, reply) => {
      const { db } = req.params as { db: string };

      if (!isValidIdentifier(db)) {
        return reply.status(400).send({ error: "Invalid database name" });
      }

      await server.poolManager.releasePool(db);
      server.log.info(`Pool stopped: ${db}`);
      return reply.send({ name: db, pool_active: false });
    })
  );

  // POST /admin/databases/:db/pool/start — pool'u başlat (lazy init + test)
  server.post(
    "/databases/:db/pool/start",
    {
      schema: {
        description: "Open (or re-open) the connection pool for a database",
        tags: ["admin"],
        params: {
          type: "object",
          properties: { db: { type: "string" } },
        },
      },
    },
    asyncHandler(async (req, reply) => {
      const { db } = req.params as { db: string };

      if (!isValidIdentifier(db)) {
        return reply.status(400).send({ error: "Invalid database name" });
      }

      const dbSql = server.poolManager.getPool(db); // lazy init
      await dbSql`SELECT 1`; // bağlantıyı doğrula
      server.log.info(`Pool started: ${db}`);
      return reply.send({ name: db, pool_active: true });
    })
  );

  // POST /admin/databases
  server.post(
    "/databases",
    {
      schema: {
        description: "Create a new database",
        tags: ["admin"],
        body: {
          type: "object",
          required: ["name"],
          properties: {
            name: { type: "string" },
          },
        },
      },
    },
    asyncHandler(async (req, reply) => {
      const { name } = req.body as { name: string };

      if (!isValidIdentifier(name)) {
        return reply.status(400).send({ error: "Invalid database name" });
      }

      const sql = server.poolManager.getPool("postgres");
      await sql.unsafe(`CREATE DATABASE "${name}"`);

      server.log.info(`Database created: ${name}`);
      return reply.status(201).send({ name, created: true });
    })
  );

  // DELETE /admin/databases/:db
  server.delete(
    "/databases/:db",
    {
      schema: {
        description: "Drop a database",
        tags: ["admin"],
        params: {
          type: "object",
          properties: { db: { type: "string" } },
        },
      },
    },
    asyncHandler(async (req, reply) => {
      const { db } = req.params as { db: string };

      if (!isValidIdentifier(db)) {
        return reply.status(400).send({ error: "Invalid database name" });
      }

      // Pool'u kapat, settings'i temizle, sonra DROP
      await server.poolManager.releasePool(db);
      await server.settings.deleteDatabase(db);

      const sql = server.poolManager.getPool("postgres");
      await sql.unsafe(`DROP DATABASE IF EXISTS "${db}" WITH (FORCE)`);

      server.log.info(`Database dropped: ${db}`);
      return reply.send({ name: db, dropped: true });
    })
  );

  // PUT /admin/databases/:db/settings — auto_start güncelle
  server.put(
    "/databases/:db/settings",
    {
      schema: {
        description: "Update per-database settings (auto_start)",
        tags: ["admin"],
        params: {
          type: "object",
          properties: { db: { type: "string" } },
        },
        body: {
          type: "object",
          required: ["auto_start"],
          properties: {
            auto_start: { type: "boolean" },
          },
        },
      },
    },
    asyncHandler(async (req, reply) => {
      const { db } = req.params as { db: string };
      const { auto_start } = req.body as { auto_start: boolean };

      if (!isValidIdentifier(db)) {
        return reply.status(400).send({ error: "Invalid database name" });
      }

      await server.settings.setAutoStart(db, auto_start);
      server.log.info(`Auto-start set to ${auto_start} for DB: ${db}`);
      return reply.send({ name: db, auto_start });
    })
  );
}