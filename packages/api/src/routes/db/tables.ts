/**
 * Tablo yönetim route'ları:
 *   GET    /db/:database/tables                        — Tabloları listele
 *   POST   /db/:database/tables                        — Tablo oluştur
 *   DELETE /db/:database/tables/:table                 — Tablo sil
 *   GET    /db/:database/tables/:table/schema          — Şemayı getir
 *   POST   /db/:database/tables/:table/columns         — Kolon ekle
 *   DELETE /db/:database/tables/:table/columns/:col    — Kolon sil
 *   PATCH  /db/:database/tables/:table/columns/:col    — Kolon güncelle (nullable/default)
 */

import type { FastifyInstance } from "fastify";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { scopeGuard } from "../../middleware/scopeGuard.js";
import { assertIdentifier } from "../../utils/identifier.js";
import { assertColumnType, assertColumnDefault } from "../../utils/ddlSanitizer.js";
import { TTL } from "../../services/cacheService.js";

export async function tablesRoute(server: FastifyInstance) {
  // GET /db/:database/tables
  server.get(
    "/:database/tables",
    {
      preHandler: [scopeGuard("read")],
      schema: {
        description: "List all tables in a database",
        tags: ["tables"],
        params: { type: "object", properties: { database: { type: "string" } } },
      },
    },
    asyncHandler(async (req, reply) => {
      const dbName = req.dbName!;
      const cacheKey = server.cache.buildKey(dbName, "tables");

      const cached = await server.cache.get(cacheKey);
      if (cached) return reply.send(JSON.parse(cached));

      const sql = server.poolManager.getPool(dbName);
      const tables = await sql`
        SELECT
          t.table_name AS name,
          pg_class.reltuples::bigint AS estimated_row_count,
          pg_size_pretty(pg_total_relation_size(pg_class.oid)) AS size
        FROM information_schema.tables t
        JOIN pg_class ON pg_class.relname = t.table_name
          AND pg_class.relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
        WHERE t.table_schema = 'public'
          AND t.table_type = 'BASE TABLE'
        ORDER BY t.table_name
      `;

      const result = { tables };
      await server.cache.set(cacheKey, JSON.stringify(result), TTL.TABLE_LIST);
      return reply.send(result);
    })
  );

  // POST /db/:database/tables
  server.post(
    "/:database/tables",
    {
      preHandler: [scopeGuard("schema")],
      schema: {
        description: "Create a new table",
        tags: ["tables"],
        body: {
          type: "object",
          required: ["name", "columns"],
          properties: {
            name: { type: "string" },
            columns: {
              type: "array",
              items: {
                type: "object",
                required: ["name", "type"],
                properties: {
                  name:       { type: "string" },
                  type:       { type: "string" },
                  nullable:   { type: "boolean", default: true },
                  primaryKey: { type: "boolean", default: false },
                  unique:     { type: "boolean", default: false },
                  default:    { type: "string" },
                  // Foreign key desteği (SORUN #1 düzeltmesi)
                  references: {
                    type: "object",
                    description: "Foreign key constraint definition",
                    required: ["table"],
                    properties: {
                      table:    { type: "string", description: "Referenced table name" },
                      column:   { type: "string", description: "Referenced column name (default: id)" },
                      onDelete: {
                        type: "string",
                        enum: ["CASCADE", "SET NULL", "RESTRICT", "NO ACTION", "SET DEFAULT"],
                        default: "NO ACTION",
                        description: "ON DELETE action",
                      },
                      onUpdate: {
                        type: "string",
                        enum: ["CASCADE", "SET NULL", "RESTRICT", "NO ACTION", "SET DEFAULT"],
                        default: "NO ACTION",
                        description: "ON UPDATE action",
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    asyncHandler(async (req, reply) => {
      const dbName = req.dbName!;
      const { name, columns } = req.body as {
        name: string;
        columns: Array<{
          name: string;
          type: string;
          nullable?: boolean;
          primaryKey?: boolean;
          unique?: boolean;
          default?: string;
          references?: {
            table: string;
            column?: string;
            onDelete?: string;
            onUpdate?: string;
          };
        }>;
      };

      assertIdentifier(name, "table");

      // FK constraint'lerini inline kolon tanımlarından ayırıyoruz.
      // PostgreSQL'de inline REFERENCES sözdizimi geçerli ama tablo seviyesi
      // FOREIGN KEY kısıtları daha okunabilir ve constraint ismi verilebilir.
      const fkConstraints: string[] = [];

      const colDefs = columns.map((col) => {
        assertIdentifier(col.name, "column");
        const safeType = assertColumnType(col.type, col.name);
        const parts: string[] = [`"${col.name}" ${safeType}`];
        if (col.primaryKey) parts.push("PRIMARY KEY");
        if (!col.nullable && !col.primaryKey) parts.push("NOT NULL");
        if (col.unique) parts.push("UNIQUE");
        if (col.default) {
          const safeDefault = assertColumnDefault(col.default, col.name);
          parts.push(`DEFAULT ${safeDefault}`);
        }

        // Foreign key desteği (SORUN #1 düzeltmesi)
        if (col.references) {
          const refTable = col.references.table;
          const refCol = col.references.column ?? "id";
          // Güvenlik: tablo ve kolon adlarını validate et
          assertIdentifier(refTable, "referenced table");
          assertIdentifier(refCol, "referenced column");

          // ON DELETE / ON UPDATE için whitelist — SQL injection'a kapalı
          const ALLOWED_ACTIONS = new Set([
            "CASCADE", "SET NULL", "RESTRICT", "NO ACTION", "SET DEFAULT",
          ]);
          const onDelete = col.references.onDelete?.toUpperCase() ?? "NO ACTION";
          const onUpdate = col.references.onUpdate?.toUpperCase() ?? "NO ACTION";
          if (!ALLOWED_ACTIONS.has(onDelete)) {
            throw new Error(`Invalid ON DELETE action: ${col.references.onDelete}`);
          }
          if (!ALLOWED_ACTIONS.has(onUpdate)) {
            throw new Error(`Invalid ON UPDATE action: ${col.references.onUpdate}`);
          }

          // Constraint adı deterministik — tablo+kolon kombinasyonundan türetilir
          const constraintName = `fk_${name}_${col.name}`;
          fkConstraints.push(
            `CONSTRAINT "${constraintName}" FOREIGN KEY ("${col.name}") ` +
            `REFERENCES "${refTable}"("${refCol}") ` +
            `ON DELETE ${onDelete} ON UPDATE ${onUpdate}`
          );
        }

        return parts.join(" ");
      });

      const allDefs = [...colDefs, ...fkConstraints];
      const ddl = `CREATE TABLE "${name}" (${allDefs.join(", ")})`;
      const sql = server.poolManager.getPool(dbName);
      await sql.unsafe(ddl);

      // Tablo listesi cache'ini geçersiz kıl
      await server.cache.invalidatePattern(
        server.cache.buildKey(dbName, "tables*")
      );

      return reply.status(201).send({ name, created: true });
    })
  );

  // DELETE /db/:database/tables/:table
  server.delete(
    "/:database/tables/:table",
    {
      preHandler: [scopeGuard("schema")],
      schema: {
        description: "Drop a table",
        tags: ["tables"],
      },
    },
    asyncHandler(async (req, reply) => {
      const dbName = req.dbName!;
      const { table } = req.params as { table: string };

      assertIdentifier(table, "table");

      const sql = server.poolManager.getPool(dbName);
      await sql.unsafe(`DROP TABLE IF EXISTS "${table}"`);

      await server.cache.invalidatePattern(
        server.cache.buildKey(dbName, "*")
      );

      return reply.send({ name: table, dropped: true });
    })
  );

  // GET /db/:database/tables/:table/schema
  server.get(
    "/:database/tables/:table/schema",
    {
      preHandler: [scopeGuard("read")],
      schema: {
        description: "Get table schema (columns, types, constraints)",
        tags: ["tables"],
      },
    },
    asyncHandler(async (req, reply) => {
      const dbName = req.dbName!;
      const { table } = req.params as { table: string };
      assertIdentifier(table, "table");

      const cacheKey = server.cache.buildKey(dbName, "schema", table);
      const cached = await server.cache.get(cacheKey);
      if (cached) return reply.send(JSON.parse(cached));

      const sql = server.poolManager.getPool(dbName);
      const columns = await sql`
        SELECT
          c.column_name AS name,
          c.data_type AS type,
          c.is_nullable AS nullable,
          c.column_default AS default,
          EXISTS (
            SELECT 1 FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu
              ON tc.constraint_name = kcu.constraint_name
            WHERE tc.table_name = c.table_name
              AND kcu.column_name = c.column_name
              AND tc.constraint_type = 'PRIMARY KEY'
          ) AS primary_key
        FROM information_schema.columns c
        WHERE c.table_schema = 'public'
          AND c.table_name = ${table}
        ORDER BY c.ordinal_position
      `;

      const result = { table, columns };
      await server.cache.set(cacheKey, JSON.stringify(result), TTL.SCHEMA);
      return reply.send(result);
    })
  );

  // ─── Kolon yönetimi ────────────────────────────────────────────────────────

  // POST /db/:database/tables/:table/columns — yeni kolon ekle
  server.post(
    "/:database/tables/:table/columns",
    {
      preHandler: [scopeGuard("schema")],
      schema: {
        description: "Add a column to an existing table",
        tags: ["tables"],
        body: {
          type: "object",
          required: ["name", "type"],
          properties: {
            name: { type: "string" },
            type: { type: "string" },
            nullable: { type: "boolean", default: true },
            default: { type: "string" },
          },
        },
      },
    },
    asyncHandler(async (req, reply) => {
      const dbName = req.dbName!;
      const { table } = req.params as { table: string };
      const body = req.body as {
        name: string;
        type: string;
        nullable?: boolean;
        default?: string;
      };

      assertIdentifier(table, "table");
      assertIdentifier(body.name, "column");
      const safeType = assertColumnType(body.type, body.name);

      const parts: string[] = [`ALTER TABLE "${table}" ADD COLUMN "${body.name}" ${safeType}`];

      if (body.default !== undefined) {
        const safeDefault = assertColumnDefault(body.default, body.name);
        parts[0] += ` DEFAULT ${safeDefault}`;
      }

      // nullable: false → NOT NULL (ama sadece default varsa veya nullable açıkça false verilmişse)
      if (body.nullable === false) {
        if (body.default === undefined) {
          // NOT NULL kolona default olmadan eklemek mevcut satırları kırar — net hata
          return reply.status(400).send({
            error:
              "Cannot add a NOT NULL column without a DEFAULT value to a table that may have existing rows. " +
              "Provide a default value or set nullable: true.",
          });
        }
        parts[0] += " NOT NULL";
      }

      const sql = server.poolManager.getPool(dbName);
      await sql.unsafe(parts[0]);

      // Schema cache'ini geçersiz kıl
      await server.cache.invalidatePattern(
        server.cache.buildKey(dbName, "schema", table, "*")
      );
      await server.cache.invalidatePattern(
        server.cache.buildKey(dbName, "tables*")
      );

      return reply.status(201).send({ table, column: body.name, added: true });
    })
  );

  // DELETE /db/:database/tables/:table/columns/:col — kolon sil
  server.delete(
    "/:database/tables/:table/columns/:col",
    {
      preHandler: [scopeGuard("schema")],
      schema: {
        description: "Drop a column from a table",
        tags: ["tables"],
      },
    },
    asyncHandler(async (req, reply) => {
      const dbName = req.dbName!;
      const { table, col } = req.params as { table: string; col: string };

      assertIdentifier(table, "table");
      assertIdentifier(col, "column");

      const sql = server.poolManager.getPool(dbName);
      await sql.unsafe(`ALTER TABLE "${table}" DROP COLUMN IF EXISTS "${col}"`);

      await server.cache.invalidatePattern(
        server.cache.buildKey(dbName, "schema", table, "*")
      );
      await server.cache.invalidatePattern(
        server.cache.buildKey(dbName, "rows", table, "*")
      );

      return reply.send({ table, column: col, dropped: true });
    })
  );

  // PATCH /db/:database/tables/:table/columns/:col — kolon güncelle
  server.patch(
    "/:database/tables/:table/columns/:col",
    {
      preHandler: [scopeGuard("schema")],
      schema: {
        description:
          "Alter a column: change nullability or default. " +
          "Type changes are not supported (destructive — use raw SQL query).",
        tags: ["tables"],
        body: {
          type: "object",
          properties: {
            nullable: {
              type: "boolean",
              description: "true → DROP NOT NULL, false → SET NOT NULL",
            },
            default: {
              type: "string",
              description: "New default value expression",
            },
            dropDefault: {
              type: "boolean",
              description: "true → DROP DEFAULT (overrides `default` field)",
            },
          },
        },
      },
    },
    asyncHandler(async (req, reply) => {
      const dbName = req.dbName!;
      const { table, col } = req.params as { table: string; col: string };
      const body = req.body as {
        nullable?: boolean;
        default?: string;
        dropDefault?: boolean;
      };

      assertIdentifier(table, "table");
      assertIdentifier(col, "column");

      const statements: string[] = [];

      if (body.nullable === true) {
        statements.push(`ALTER TABLE "${table}" ALTER COLUMN "${col}" DROP NOT NULL`);
      } else if (body.nullable === false) {
        statements.push(`ALTER TABLE "${table}" ALTER COLUMN "${col}" SET NOT NULL`);
      }

      if (body.dropDefault === true) {
        statements.push(`ALTER TABLE "${table}" ALTER COLUMN "${col}" DROP DEFAULT`);
      } else if (body.default !== undefined) {
        const safeDefault = assertColumnDefault(body.default, col);
        statements.push(`ALTER TABLE "${table}" ALTER COLUMN "${col}" SET DEFAULT ${safeDefault}`);
      }

      if (statements.length === 0) {
        return reply.status(400).send({
          error: "No valid fields to update. Provide nullable, default, or dropDefault.",
        });
      }

      const sql = server.poolManager.getPool(dbName);
      for (const stmt of statements) {
        await sql.unsafe(stmt);
      }

      await server.cache.invalidatePattern(
        server.cache.buildKey(dbName, "schema", table, "*")
      );

      return reply.send({ table, column: col, updated: true });
    })
  );
}