/**
 * Admin DB management routes:
 *   GET    /admin/databases       — DB list + size + table count
 *   POST   /admin/databases       — Create a new DB
 *   DELETE /admin/databases/:db   — Drop DB (PostgreSQL-level DROP)
 *   GET    /admin/databases/:db/api-key        — Return the API key
 *   POST   /admin/databases/:db/api-key/rotate — Rotate the API key
 *   POST   /admin/databases/:db/schema-cache/reload — E-27 schema cache invalidate
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

      // Table count per DB — reuse an already-open pool if available, otherwise connect briefly
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
            // Connection error — return 0
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
        // Continue even without auth schema
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

      // Close the pool first (open connections may block DROP)
      await server.poolManager.releasePool(db);

      // DROP DATABASE — run against the postgres maintenance DB
      const sql = server.poolManager.getPool("postgres");

      // Force-terminate any remaining connections
      // Parameterised query — even though the identifier has already been validated,
      // string interpolation would violate defence-in-depth.
      try {
        await sql.unsafe(
          `SELECT pg_terminate_backend(pid)
           FROM pg_stat_activity
           WHERE datname = $1 AND pid <> pg_backend_pid()`,
          [db]
        );
      } catch {
        // Attempt DROP even if termination fails
      }

      await sql.unsafe(`DROP DATABASE IF EXISTS "${db}"`);

      // Clean up settings after DROP
      try {
        await server.settings.deleteDatabase(db);
      } catch {
        // Ignore error if no settings record exists
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
              api_key: { type: "string" },
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
              api_key: { type: "string" },
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

  // POST /admin/databases/:db/schema-cache/reload (E-27)
  server.post(
    "/databases/:db/schema-cache/reload",
    {
      schema: {
        description:
          "Invalidate cached schema/introspection data for a database (E-27). " +
          "Use after migrations so tables/views/functions/indexes lists refresh. " +
          "Requires admin token. Returns 204.",
        tags: ["admin"],
        params: {
          type: "object",
          required: ["db"],
          properties: { db: { type: "string" } },
        },
        response: {
          204: { type: "null", description: "Cache cleared" },
        },
      },
    },
    asyncHandler(async (req, reply) => {
      const { db } = req.params as { db: string };

      if (!isValidIdentifier(db)) {
        return reply.status(400).send({ error: "Invalid database name" });
      }

      // Drop all postgrify:{db}:* keys (tables, schema, rows, views, ...).
      // buildKey strips "*"; append wildcard after the db prefix.
      const prefix = server.cache.buildKey(db);
      await server.cache.invalidatePattern(`${prefix}:*`);

      server.log.info({ db }, "Schema cache reloaded");
      return reply.status(204).send();
    })
  );
}
