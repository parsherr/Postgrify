/**
 * GET /db/:database/backup/download — SQL dump (pg_dump olmadan, pure postgres.js)
 *
 * Şunları içerir:
 *   - public schema'daki tüm tablolar için CREATE TABLE IF NOT EXISTS DDL
 *   - Her tablonun tüm satırları için INSERT INTO ifadeleri
 *   - BEGIN / COMMIT transaction wrapper
 *
 * Kısıtlamalar:
 *   - Sadece public schema
 *   - View, sequence, index, foreign key, trigger dahil değil (temel dump)
 *   - Satırlar cursor ile 100'erli batch'lerde okunur (OOM riski düşürülmüştür)
 *   - Response tek seferde gönderilir; streaming HTTP response sonraki versiyona bırakılmıştır
 */

import type { FastifyInstance } from "fastify";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { scopeGuard } from "../../middleware/scopeGuard.js";

// SQL string escape — tek tırnak içindeki değerler için
function escapeSqlString(val: string): string {
  return val.replace(/'/g, "''").replace(/\\/g, "\\\\");
}

// Değeri SQL literal'e çevir
function toSqlLiteral(val: unknown): string {
  if (val === null || val === undefined) return "NULL";
  if (typeof val === "boolean") return val ? "TRUE" : "FALSE";
  if (typeof val === "number") return String(val);
  if (val instanceof Date) return `'${val.toISOString()}'`;
  if (typeof val === "object") return `'${escapeSqlString(JSON.stringify(val))}'`;
  return `'${escapeSqlString(String(val))}'`;
}

// Identifier'ı çift tırnakla koru
function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

export async function backupRoute(server: FastifyInstance) {
  server.get(
    "/:database/backup/download",
    {
      preHandler: [scopeGuard("schema")],
      schema: {
        description: "Download a SQL backup of the database",
        tags: ["backup"],
        params: {
          type: "object",
          properties: { database: { type: "string" } },
        },
      },
    },
    asyncHandler(async (req, reply) => {
      const dbName = req.dbName!;
      const sql = server.poolManager.getPool(dbName);

      // ── 1. Tablo listesini al ──────────────────────────────────────────────
      const tablesResult = await sql<{ tablename: string }[]>`
        SELECT tablename
        FROM pg_catalog.pg_tables
        WHERE schemaname = 'public'
        ORDER BY tablename
      `;
      const tableNames = tablesResult.map((r) => r.tablename);

      // ── 2. Her tablo için sütun şemasını al ──────────────────────────────
      type ColumnInfo = {
        column_name: string;
        data_type: string;
        character_maximum_length: number | null;
        numeric_precision: number | null;
        numeric_scale: number | null;
        is_nullable: string;
        column_default: string | null;
      };

      const schemaMap: Record<string, ColumnInfo[]> = {};
      for (const tbl of tableNames) {
        const cols = await sql<ColumnInfo[]>`
          SELECT
            column_name,
            data_type,
            character_maximum_length,
            numeric_precision,
            numeric_scale,
            is_nullable,
            column_default
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name   = ${tbl}
          ORDER BY ordinal_position
        `;
        schemaMap[tbl] = cols;
      }

      // ── 3. Primary key bilgisi ────────────────────────────────────────────
      type PkInfo = { table_name: string; column_name: string };
      const pkRows = await sql<PkInfo[]>`
        SELECT kcu.table_name, kcu.column_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
         AND tc.table_schema    = kcu.table_schema
        WHERE tc.constraint_type = 'PRIMARY KEY'
          AND tc.table_schema    = 'public'
      `;
      const pkMap: Record<string, string[]> = {};
      for (const row of pkRows) {
        if (!pkMap[row.table_name]) pkMap[row.table_name] = [];
        pkMap[row.table_name].push(row.column_name);
      }

      // ── 4. Dump string'ini oluştur ────────────────────────────────────────
      const now = new Date().toISOString();
      const dateTag = now.slice(0, 10).replace(/-/g, "");
      const lines: string[] = [];

      lines.push(`-- Postgrify SQL Backup`);
      lines.push(`-- Database : ${dbName}`);
      lines.push(`-- Generated: ${now}`);
      lines.push(`-- Tables   : ${tableNames.length}`);
      lines.push(`-- Note     : public schema only`);
      lines.push("");
      lines.push("BEGIN;");
      lines.push("");

      for (const tbl of tableNames) {
        const cols = schemaMap[tbl] ?? [];
        const pks  = pkMap[tbl] ?? [];

        // CREATE TABLE
        lines.push(`-- ── Table: ${tbl} ──`);
        lines.push(`CREATE TABLE IF NOT EXISTS ${quoteIdent("public")}.${quoteIdent(tbl)} (`);

        const colDefs = cols.map((c) => {
          let typeDef = c.data_type.toUpperCase();
          if (c.character_maximum_length) typeDef += `(${c.character_maximum_length})`;
          else if (c.numeric_precision && c.numeric_scale != null)
            typeDef += `(${c.numeric_precision},${c.numeric_scale})`;

          let def = `  ${quoteIdent(c.column_name)} ${typeDef}`;
          if (c.column_default) def += ` DEFAULT ${c.column_default}`;
          if (c.is_nullable === "NO") def += " NOT NULL";
          return def;
        });

        if (pks.length > 0) {
          colDefs.push(`  PRIMARY KEY (${pks.map(quoteIdent).join(", ")})`);
        }

        lines.push(colDefs.join(",\n") + "\n);");
        lines.push("");

        // Satırları cursor ile 100'erli batch'lerde oku — büyük tablolarda peak memory düşer
        const colNames = cols.map((c) => quoteIdent(c.column_name)).join(", ");
        let hasRows = false;
        const cursor = await sql`SELECT * FROM ${sql(tbl)}`.cursor(100);
        for await (const batch of cursor) {
          for (const row of batch) {
            hasRows = true;
            const vals = cols
              .map((c) => toSqlLiteral((row as Record<string, unknown>)[c.column_name]))
              .join(", ");
            lines.push(
              `INSERT INTO ${quoteIdent("public")}.${quoteIdent(tbl)} (${colNames}) VALUES (${vals});`
            );
          }
        }
        if (hasRows) lines.push("");
      }

      lines.push("COMMIT;");
      lines.push("");

      const content = lines.join("\n");

      // ── 5. Response ───────────────────────────────────────────────────────
      const filename = `${dbName}_${dateTag}.sql`;
      reply
        .header("Content-Type", "application/octet-stream")
        .header("Content-Disposition", `attachment; filename="${filename}"`)
        .header("Content-Length", Buffer.byteLength(content, "utf8").toString())
        .send(content);
    })
  );
}