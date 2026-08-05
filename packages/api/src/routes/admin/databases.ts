/**
 * Admin DB yönetim route'ları:
 *   GET    /admin/databases        — DB listesi + boyut + tablo sayısı
 *   POST   /admin/databases        — Yeni DB oluştur
 *   DELETE /admin/databases/:db    — DB sil
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
        description: "List all databases with size and table count",
        tags: ["admin"],
      },
    },
    asyncHandler(async (_req, reply) => {
      // postgres veritabanı admin bağlantısı için kullanılır
      const sql = server.poolManager.getPool("postgres");

      const databases = await sql`
        SELECT
          d.datname AS name,
          pg_database_size(d.datname) AS size_bytes,
          (
            SELECT count(*)
            FROM information_schema.tables t
            WHERE t.table_schema = 'public'
              AND t.table_catalog = d.datname
              AND t.table_type = 'BASE TABLE'
          ) AS table_count
        FROM pg_database d
        WHERE d.datistemplate = false
          AND d.datname != 'postgres'
        ORDER BY d.datname
      `;

      return reply.send({ databases });
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
      // postgres.js template literal ile identifier injection mümkün değil;
      // CREATE DATABASE DDL için unsafe() kullanılır ve identifier validate edilmiştir.
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

      // Mevcut pool'u kapat (bağlantı kesilmeden DROP çalışmaz)
      await server.poolManager.releasePool(db);

      const sql = server.poolManager.getPool("postgres");
      await sql.unsafe(
        `DROP DATABASE IF EXISTS "${db}" WITH (FORCE)`
      );

      server.log.info(`Database dropped: ${db}`);
      return reply.send({ name: db, dropped: true });
    })
  );
}