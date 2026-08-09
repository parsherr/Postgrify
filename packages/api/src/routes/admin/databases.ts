/**
 * Admin DB yönetim route'ları:
 *   GET    /admin/databases       — DB listesi + boyut + tablo sayısı
 *   POST   /admin/databases       — Yeni DB oluştur
 *   DELETE /admin/databases/:db   — DB sil (PostgreSQL seviyesinde DROP)
 *   GET    /admin/databases/:db/api-key        — API key'i döner
 *   POST   /admin/databases/:db/api-key/rotate — API key'i yeniler
 */

import type { FastifyInstance } from "fastify";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { isValidIdentifier } from "../../utils/identifier.js";
import { ensureAuthSchema, provisionApiKey, getApiKey } from "../db/auth/provision.js";

export async function databasesRoute(server: FastifyInstance) {
  // GET /admin/databases
  server.get(
    "/databases",
    {
      schema: {
        description: "List all databases with size and table count",
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

      // Her DB için tablo sayısı — zaten açık pool varsa kullan, yoksa kısa süreli bağlan
      const databases = await Promise.all(
        dbRows.map(async (row) => {
          const name = row.name as string;
          let tableCount = 0;

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

          return {
            name,
            size_bytes: Number(row.size_bytes),
            table_count: tableCount,
          };
        })
      );

      return reply.send({ databases });
    })
  );

  // POST /admin/databases
  server.post(
    "/databases",
    {
      schema: {
        description: "Create a new PostgreSQL database",
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

      // Auth schema + API key provisioning
      let apiKey: string | undefined;
      try {
        const dbSql = server.poolManager.getPool(name);
        await ensureAuthSchema(dbSql);
        apiKey = await provisionApiKey(dbSql);
      } catch {
        // Auth schema olmadan da devam et
      }

      server.log.info(`Database created: ${name}`);
      return reply.status(201).send({ name, created: true, api_key: apiKey });
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

      // Önce pool'u kapat (açık bağlantılar DROP'u engelleyebilir)
      await server.poolManager.releasePool(db);

      // DROP DATABASE — postgres maintenance DB üzerinden çalıştır
      const sql = server.poolManager.getPool("postgres");

      // Varsa kalan bağlantıları zorla kes
      // Parametrik sorgu — identifier kontrolü geçmiş olsa bile string
      // interpolasyonu savunma derinliği ilkesini ihlal eder.
      try {
        await sql.unsafe(
          `SELECT pg_terminate_backend(pid)
           FROM pg_stat_activity
           WHERE datname = $1 AND pid <> pg_backend_pid()`,
          [db]
        );
      } catch {
        // Hata olsa bile DROP'u dene
      }

      await sql.unsafe(`DROP DATABASE IF EXISTS "${db}"`);

      // Settings'i DROP sonrası temizle
      try {
        await server.settings.deleteDatabase(db);
      } catch {
        // Settings kaydı yoksa hata yoksay
      }

      server.log.info(`Database dropped: ${db}`);
      return reply.send({ name: db, dropped: true });
    })
  );

  // GET /admin/databases/:db/api-key
  server.get(
    "/databases/:db/api-key",
    {
      schema: {
        description: "Get the API key for a managed database. Requires admin token.",
        tags: ["admin"],
        params: {
          type: "object",
          properties: { db: { type: "string" } },
        },
        response: {
          200: {
            type: "object",
            properties: {
              database: { type: "string" },
              api_key:  { type: "string" },
            },
          },
        },
      },
    },
    asyncHandler(async (req, reply) => {
      const { db } = req.params as { db: string };

      if (!isValidIdentifier(db)) {
        return reply.status(400).send({ error: "Invalid database name" });
      }

      const dbSql = server.poolManager.getPool(db);
      const key = await getApiKey(dbSql);

      if (!key) {
        return reply.status(404).send({ error: "No API key found for this database" });
      }

      return reply.send({ database: db, api_key: key });
    })
  );

  // POST /admin/databases/:db/api-key/rotate
  server.post(
    "/databases/:db/api-key/rotate",
    {
      schema: {
        description: "Rotate the API key for a managed database. Requires admin token.",
        tags: ["admin"],
        params: {
          type: "object",
          properties: { db: { type: "string" } },
        },
        response: {
          200: {
            type: "object",
            properties: {
              database: { type: "string" },
              api_key:  { type: "string" },
            },
          },
        },
      },
    },
    asyncHandler(async (req, reply) => {
      const { db } = req.params as { db: string };

      if (!isValidIdentifier(db)) {
        return reply.status(400).send({ error: "Invalid database name" });
      }

      const dbSql = server.poolManager.getPool(db);
      await ensureAuthSchema(dbSql);
      const newKey = await provisionApiKey(dbSql);

      return reply.send({ database: db, api_key: newKey });
    })
  );
}