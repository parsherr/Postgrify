/**
 * Backup Service — PostgreSQL veritabanı yedekleme ve geri yükleme.
 *
 * Özellikler:
 *   - Sunucu dosya sistemine .sql.gz olarak sıkıştırılmış yedek yazar
 *   - Her backup'ın metadata'sı _postgrify_backups tablosuna kaydedilir
 *   - DDL kapsamı: tablolar + view'lar + sequence'lar + index'ler + FK'lar + trigger'lar
 *   - Satırlar cursor ile 500'erli batch'lerde okunur (OOM riski azaltılmış)
 *   - Restore: gzip decompress → satır satır parse → transaction içinde çalıştır
 *
 * Storage:
 *   BACKUP_DIR env var (default: /data/backups)
 *   Dosya adı: <dbName>_<YYYYMMDDTHHMMSS>_<uuid8>.sql.gz
 */

import { createWriteStream, createReadStream, statSync, mkdirSync, existsSync, unlinkSync } from "fs";
import { createGzip, createGunzip } from "zlib";
import { pipeline } from "stream/promises";
import { Readable, Transform } from "stream";
import { randomUUID } from "crypto";
import { join } from "path";
import { createInterface } from "readline";
import type postgres from "postgres";

// ── Types ─────────────────────────────────────────────────────────────────────

export type BackupStatus = "completed" | "failed" | "in_progress";

export interface BackupMeta {
  id: string;
  db_name: string;
  file_path: string;
  size_bytes: number | null;
  status: BackupStatus;
  created_at: string;
  error_msg: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * postgres.js, BIGINT kolonlarını BigInt olarak döndürür.
 * JSON serialize edilebilmesi ve schema uyumu için Number'a çevir.
 * 2^53'ü aşan dosya boyutları pratikte imkânsız olduğundan güvenli.
 */
function normalizeMeta(row: BackupMeta): BackupMeta {
  return {
    ...row,
    size_bytes: row.size_bytes != null ? Number(row.size_bytes) : null,
  };
}

// ── SQL helpers ───────────────────────────────────────────────────────────────

function escapeSqlString(val: string): string {
  return val.replace(/'/g, "''").replace(/\\/g, "\\\\");
}

function toSqlLiteral(val: unknown): string {
  if (val === null || val === undefined) return "NULL";
  if (typeof val === "boolean") return val ? "TRUE" : "FALSE";
  if (typeof val === "number") return String(val);
  if (val instanceof Date) return `'${val.toISOString()}'`;
  if (Buffer.isBuffer(val)) return `'\\x${val.toString("hex")}'`;
  if (typeof val === "object") return `'${escapeSqlString(JSON.stringify(val))}'`;
  return `'${escapeSqlString(String(val))}'`;
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

// ── BackupService ─────────────────────────────────────────────────────────────

export class BackupService {
  private readonly backupDir: string;
  // Lazy: ilk ensureMetaReady() çağrısında provision başlar; constructor'da DB bağlantısı açılmaz.
  private metaReady: Promise<void> | null = null;

  constructor(
    /** postgres DB pool — sadece metadata için kullanılır */
    private readonly metaSql: postgres.Sql,
    backupDir: string,
  ) {
    this.backupDir = backupDir;
  }

  // ── Provision ──────────────────────────────────────────────────────────────

  private async provisionMeta(): Promise<void> {
    try {
      await this.metaSql`
        CREATE TABLE IF NOT EXISTS _postgrify_backups (
          id          TEXT        PRIMARY KEY,
          db_name     TEXT        NOT NULL,
          file_path   TEXT        NOT NULL,
          size_bytes  BIGINT,
          status      TEXT        NOT NULL DEFAULT 'in_progress',
          created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
          error_msg   TEXT
        )
      `;
      // Hızlı lookup için index
      await this.metaSql`
        CREATE INDEX IF NOT EXISTS idx_pg_backups_db_created
          ON _postgrify_backups (db_name, created_at DESC)
      `;
    } catch (err) {
      this.metaReady = Promise.reject(err);
      throw err;
    }
  }

  private async ensureMetaReady(): Promise<void> {
    if (!this.metaReady) {
      this.metaReady = this.provisionMeta();
    }
    try {
      await this.metaReady;
    } catch {
      // Retry on next call
      this.metaReady = null;
      throw new Error("Backup metadata table could not be provisioned");
    }
  }

  // ── Storage path helpers ───────────────────────────────────────────────────

  private dirFor(dbName: string): string {
    const dir = join(this.backupDir, dbName);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    return dir;
  }

  private buildFilename(dbName: string): string {
    const ts = new Date()
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(".", "T")
      .slice(0, 15); // YYYYMMDDTHHMMSS
    const uid = randomUUID().replace(/-/g, "").slice(0, 8);
    return `${dbName}_${ts}_${uid}.sql.gz`;
  }

  // ── Metadata CRUD ──────────────────────────────────────────────────────────

  async listBackups(dbName: string): Promise<BackupMeta[]> {
    await this.ensureMetaReady();
    const rows = await this.metaSql<BackupMeta[]>`
      SELECT id, db_name, file_path, size_bytes, status, created_at, error_msg
      FROM _postgrify_backups
      WHERE db_name = ${dbName}
      ORDER BY created_at DESC
    `;
    return rows.map(normalizeMeta);
  }

  async listAllBackups(): Promise<BackupMeta[]> {
    await this.ensureMetaReady();
    const rows = await this.metaSql<BackupMeta[]>`
      SELECT id, db_name, file_path, size_bytes, status, created_at, error_msg
      FROM _postgrify_backups
      ORDER BY created_at DESC
    `;
    return rows.map(normalizeMeta);
  }

  async getBackup(id: string): Promise<BackupMeta | null> {
    await this.ensureMetaReady();
    const [row] = await this.metaSql<BackupMeta[]>`
      SELECT id, db_name, file_path, size_bytes, status, created_at, error_msg
      FROM _postgrify_backups
      WHERE id = ${id}
    `;
    return row ? normalizeMeta(row) : null;
  }

  private async insertMeta(
    id: string,
    dbName: string,
    filePath: string,
  ): Promise<void> {
    await this.metaSql`
      INSERT INTO _postgrify_backups (id, db_name, file_path, status)
      VALUES (${id}, ${dbName}, ${filePath}, 'in_progress')
    `;
  }

  private async completeMeta(id: string, sizeBytes: number): Promise<void> {
    await this.metaSql`
      UPDATE _postgrify_backups
      SET status = 'completed', size_bytes = ${sizeBytes}
      WHERE id = ${id}
    `;
  }

  private async failMeta(id: string, errorMsg: string): Promise<void> {
    await this.metaSql`
      UPDATE _postgrify_backups
      SET status = 'failed', error_msg = ${errorMsg}
      WHERE id = ${id}
    `;
  }

  async deleteBackup(id: string): Promise<void> {
    await this.ensureMetaReady();
    const meta = await this.getBackup(id);
    if (!meta) return;

    // Dosyayı sil (yoksa sessizce geç)
    try {
      if (existsSync(meta.file_path)) unlinkSync(meta.file_path);
    } catch {
      // dosya zaten yoksa önemli değil
    }

    await this.metaSql`DELETE FROM _postgrify_backups WHERE id = ${id}`;
  }

  /** Belirli bir DB'nin en eski yedeklerini siler; `keep` kadar yeni olanı bırakır. */
  async enforceRetention(dbName: string, keep: number): Promise<void> {
    await this.ensureMetaReady();
    if (keep <= 0) return;

    const old = await this.metaSql<{ id: string }[]>`
      SELECT id FROM _postgrify_backups
      WHERE db_name = ${dbName} AND status = 'completed'
      ORDER BY created_at DESC
      OFFSET ${keep}
    `;

    for (const row of old) {
      await this.deleteBackup(row.id);
    }
  }

  // ── DDL builder ───────────────────────────────────────────────────────────

  private async buildDump(dbName: string, sql: postgres.Sql): Promise<string> {
    const lines: string[] = [];
    const now = new Date().toISOString();

    // ── Header ──────────────────────────────────────────────────────────────
    lines.push(`-- Postgrify SQL Backup`);
    lines.push(`-- Database : ${dbName}`);
    lines.push(`-- Generated: ${now}`);
    lines.push(`-- Note     : public schema — tables, views, sequences, indexes, FKs, triggers`);
    lines.push(``);
    lines.push(`BEGIN;`);
    lines.push(``);

    // ── 1. Sequences ────────────────────────────────────────────────────────
    type SeqRow = { sequence_name: string; start_value: string; increment: string; min_value: string; max_value: string; cycle_option: string };
    const sequences = await sql<SeqRow[]>`
      SELECT
        s.sequence_name,
        s.start_value,
        s.increment,
        s.minimum_value AS min_value,
        s.maximum_value AS max_value,
        s.cycle_option
      FROM information_schema.sequences s
      WHERE s.sequence_schema = 'public'
      ORDER BY s.sequence_name
    `;

    if (sequences.length > 0) {
      lines.push(`-- ── Sequences ────────────────────────────────────────────`);
      for (const seq of sequences) {
        const cycle = seq.cycle_option === "YES" ? " CYCLE" : " NO CYCLE";
        lines.push(`CREATE SEQUENCE IF NOT EXISTS ${quoteIdent(seq.sequence_name)}`);
        lines.push(`  START WITH ${seq.start_value}`);
        lines.push(`  INCREMENT BY ${seq.increment}`);
        lines.push(`  MINVALUE ${seq.min_value}`);
        lines.push(`  MAXVALUE ${seq.max_value}`);
        lines.push(`  ${cycle};`);
        lines.push(``);
      }
    }

    // ── 2. Tablolar: CREATE TABLE ────────────────────────────────────────────
    type TableRow = { tablename: string };
    const tablesResult = await sql<TableRow[]>`
      SELECT tablename
      FROM pg_catalog.pg_tables
      WHERE schemaname = 'public'
      ORDER BY tablename
    `;
    const tableNames = tablesResult.map((r) => r.tablename);

    type ColumnInfo = {
      column_name: string;
      data_type: string;
      character_maximum_length: number | null;
      numeric_precision: number | null;
      numeric_scale: number | null;
      is_nullable: string;
      column_default: string | null;
    };

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

    if (tableNames.length > 0) {
      lines.push(`-- ── Tables ───────────────────────────────────────────────`);
    }

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

      lines.push(`CREATE TABLE IF NOT EXISTS ${quoteIdent("public")}.${quoteIdent(tbl)} (`);
      const colDefs = cols.map((c) => {
        let typeDef = c.data_type.toUpperCase();
        if (c.character_maximum_length) typeDef += `(${c.character_maximum_length})`;
        else if (c.numeric_precision != null && c.numeric_scale != null)
          typeDef += `(${c.numeric_precision},${c.numeric_scale})`;

        let def = `  ${quoteIdent(c.column_name)} ${typeDef}`;
        if (c.column_default) def += ` DEFAULT ${c.column_default}`;
        if (c.is_nullable === "NO") def += ` NOT NULL`;
        return def;
      });
      const pks = pkMap[tbl] ?? [];
      if (pks.length > 0) colDefs.push(`  PRIMARY KEY (${pks.map(quoteIdent).join(", ")})`);
      lines.push(colDefs.join(",\n") + "\n);");
      lines.push(``);
    }

    // ── 3. Tablolara satır INSERT'leri ────────────────────────────────────────
    for (const tbl of tableNames) {
      const cols = schemaMap[tbl] ?? [];
      if (cols.length === 0) continue;
      const colNames = cols.map((c) => quoteIdent(c.column_name)).join(", ");
      let hasRows = false;

      // cursor ile 500'erli batch
      const cursor = await sql`SELECT * FROM ${sql(tbl)}`.cursor(500);
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
      if (hasRows) lines.push(``);
    }

    // ── 4. Views ──────────────────────────────────────────────────────────────
    type ViewRow = { table_name: string; view_definition: string };
    const views = await sql<ViewRow[]>`
      SELECT table_name, view_definition
      FROM information_schema.views
      WHERE table_schema = 'public'
      ORDER BY table_name
    `;
    if (views.length > 0) {
      lines.push(`-- ── Views ────────────────────────────────────────────────`);
      for (const v of views) {
        lines.push(`CREATE OR REPLACE VIEW ${quoteIdent(v.table_name)} AS`);
        lines.push(`${v.view_definition};`);
        lines.push(``);
      }
    }

    // ── 5. Indexes (PK index'leri hariç) ─────────────────────────────────────
    type IndexRow = { indexname: string; tablename: string; indexdef: string };
    const indexes = await sql<IndexRow[]>`
      SELECT indexname, tablename, indexdef
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname NOT IN (
          SELECT constraint_name
          FROM information_schema.table_constraints
          WHERE constraint_type IN ('PRIMARY KEY', 'UNIQUE')
            AND table_schema = 'public'
        )
      ORDER BY tablename, indexname
    `;
    if (indexes.length > 0) {
      lines.push(`-- ── Indexes ──────────────────────────────────────────────`);
      for (const idx of indexes) {
        lines.push(`${idx.indexdef};`);
      }
      lines.push(``);
    }

    // ── 6. Foreign keys ───────────────────────────────────────────────────────
    type FkRow = {
      constraint_name: string;
      table_name: string;
      column_name: string;
      foreign_table: string;
      foreign_column: string;
      update_rule: string;
      delete_rule: string;
    };
    const fks = await sql<FkRow[]>`
      SELECT
        tc.constraint_name,
        tc.table_name,
        kcu.column_name,
        ccu.table_name  AS foreign_table,
        ccu.column_name AS foreign_column,
        rc.update_rule,
        rc.delete_rule
      FROM information_schema.table_constraints  tc
      JOIN information_schema.key_column_usage   kcu ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
      JOIN information_schema.referential_constraints rc ON tc.constraint_name = rc.constraint_name AND tc.table_schema = rc.constraint_schema
      JOIN information_schema.constraint_column_usage ccu ON rc.unique_constraint_name = ccu.constraint_name AND rc.unique_constraint_schema = ccu.constraint_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_schema    = 'public'
      ORDER BY tc.table_name, tc.constraint_name
    `;
    if (fks.length > 0) {
      lines.push(`-- ── Foreign Keys ─────────────────────────────────────────`);
      for (const fk of fks) {
        lines.push(
          `ALTER TABLE ${quoteIdent(fk.table_name)} ` +
          `ADD CONSTRAINT ${quoteIdent(fk.constraint_name)} ` +
          `FOREIGN KEY (${quoteIdent(fk.column_name)}) ` +
          `REFERENCES ${quoteIdent(fk.foreign_table)} (${quoteIdent(fk.foreign_column)}) ` +
          `ON UPDATE ${fk.update_rule} ON DELETE ${fk.delete_rule};`
        );
      }
      lines.push(``);
    }

    // ── 7. Triggers ───────────────────────────────────────────────────────────
    type TriggerRow = { trigger_name: string; event_manipulation: string; event_object_table: string; action_statement: string; action_timing: string };
    const triggers = await sql<TriggerRow[]>`
      SELECT DISTINCT
        trigger_name,
        event_manipulation,
        event_object_table,
        action_statement,
        action_timing
      FROM information_schema.triggers
      WHERE trigger_schema = 'public'
      ORDER BY event_object_table, trigger_name
    `;
    if (triggers.length > 0) {
      lines.push(`-- ── Triggers ─────────────────────────────────────────────`);
      for (const t of triggers) {
        lines.push(
          `CREATE OR REPLACE TRIGGER ${quoteIdent(t.trigger_name)} ` +
          `${t.action_timing} ${t.event_manipulation} ` +
          `ON ${quoteIdent(t.event_object_table)} ` +
          `FOR EACH ROW ${t.action_statement};`
        );
      }
      lines.push(``);
    }

    lines.push(`COMMIT;`);
    lines.push(``);

    return lines.join("\n");
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Tam DB backup'ı oluşturur, .sql.gz olarak diske yazar, metadata kaydeder.
   * Returns: BackupMeta (completed veya failed)
   */
  async createBackup(dbName: string, sql: postgres.Sql): Promise<BackupMeta> {
    await this.ensureMetaReady();

    const id = randomUUID();
    const filename = this.buildFilename(dbName);
    const filePath = join(this.dirFor(dbName), filename);

    await this.insertMeta(id, dbName, filePath);

    try {
      const dump = await this.buildDump(dbName, sql);

      // String → Readable stream → gzip → dosya
      const readableStream = Readable.from([dump]);
      const gzip = createGzip();
      const writeStream = createWriteStream(filePath);

      await pipeline(readableStream, gzip, writeStream);

      const { size } = statSync(filePath);
      await this.completeMeta(id, size);

      return (await this.getBackup(id))!;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await this.failMeta(id, msg);
      return (await this.getBackup(id))!;
    }
  }

  /**
   * Mevcut bir backup dosyasını hedef DB'ye geri yükler.
   * Tüm işlem bir transaction içinde yapılır — hata durumunda ROLLBACK.
   */
  async restoreBackup(sql: postgres.Sql, filePath: string): Promise<void> {
    if (!existsSync(filePath)) {
      throw new Error(`Backup file not found: ${filePath}`);
    }

    // gzip → satırlara ayır → toplu statement'lara birleştir
    const statements = await this.parseGzipSql(filePath);

    // Transaction içinde toplu çalıştır
    await sql.begin(async (tx) => {
      for (const stmt of statements) {
        const trimmed = stmt.trim();
        if (trimmed && !trimmed.startsWith("--")) {
          await tx.unsafe(trimmed);
        }
      }
    });
  }

  /**
   * Backup dosyasını decompress edip bireysel SQL statement'larına ayırır.
   */
  private async parseGzipSql(filePath: string): Promise<string[]> {
    return new Promise((resolve, reject) => {
      const statements: string[] = [];
      let current = "";

      const fileStream = createReadStream(filePath);
      const gunzip = createGunzip();
      const rl = createInterface({ input: fileStream.pipe(gunzip), crlfDelay: Infinity });

      rl.on("line", (line) => {
        const trimmed = line.trim();
        // -- yorumlarını ve boş satırları biriktirmeye gerek yok (BEGIN/COMMIT dahil)
        if (!trimmed || trimmed.startsWith("--")) return;

        // BEGIN / COMMIT satırlarını atla — kendi transaction'ımız var
        if (trimmed === "BEGIN;" || trimmed === "COMMIT;") return;

        current += line + "\n";
        if (trimmed.endsWith(";")) {
          statements.push(current.trim());
          current = "";
        }
      });

      rl.on("close", () => {
        if (current.trim()) statements.push(current.trim());
        resolve(statements);
      });

      rl.on("error", reject);
      fileStream.on("error", reject);
    });
  }

  /**
   * Backup dosyasını bir writable stream'e pipe eder (HTTP response için).
   * Caller stream header'larını (Content-Type, Content-Disposition) kendisi set eder.
   */
  async streamBackupToResponse(filePath: string, responseStream: NodeJS.WritableStream): Promise<void> {
    if (!existsSync(filePath)) {
      throw new Error(`Backup file not found: ${filePath}`);
    }
    const readStream = createReadStream(filePath);
    await pipeline(readStream, responseStream as NodeJS.WritableStream & { writable: boolean });
  }

  /** Dosya sistemi üzerindeki backup dosyasının boyutunu döner. Dosya yoksa null. */
  getFileSize(filePath: string): number | null {
    try {
      return statSync(filePath).size;
    } catch {
      return null;
    }
  }

  /** DB silindiğinde o DB'ye ait tüm backup metadata'sını temizler (dosyalar silinmez). */
  async cleanMetaForDatabase(dbName: string): Promise<void> {
    await this.ensureMetaReady();
    await this.metaSql`
      DELETE FROM _postgrify_backups WHERE db_name = ${dbName}
    `;
  }
}