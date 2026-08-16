/**
 * Query Builder — Gelen HTTP parametrelerini güvenli PostgreSQL sorgularına dönüştürür.
 *
 * Tüm değerler parametrik ($1, $2, ...) olarak geçirilir — SQL injection imkânsız.
 * Tablo ve kolon adları isValidIdentifier() ile validate edilir.
 *
 * Desteklenen operatörler (where ve or param'larında):
 *   eq, neq, gt, gte, lt, lte, like, ilike, in, is
 *
 * OR desteği:
 *   ?where=status.eq.active&or=role.eq.admin,role.eq.mod
 *   → WHERE "status" = 'active' AND ("role" = 'admin' OR "role" = 'mod')
 *
 * `is` operatörü değerleri:
 *   field.is.null     → "field" IS NULL
 *   field.is.not_null → "field" IS NOT NULL
 *   (Diğer değerler geçersizdir — net hata mesajı döner)
 *
 * Sıralama — iki format desteklenir:
 *   ?order=created_at.desc         (birleşik format)
 *   ?sort=created_at&order=desc    (ayrı format — Supabase/PostgREST uyumlu)
 *   İkisi birlikte verilirse "sort+order" önceliklidir.
 *
 * NOTE (turtle C-01): FTS / nested or / alias select sonraki adımlarda eklenecek.
 */

import { isValidIdentifier } from "../utils/identifier.js";

export interface SelectOptions {
  select?: string;
  where?: string[];
  or?: string[];
  order?: string;
  sort?: string;
  limit?: number;
  offset?: number;
}

export interface WhereClause {
  sql: string;
  values: unknown[];
}

const OPERATORS: Record<string, string> = {
  eq: "=",
  neq: "!=",
  gt: ">",
  gte: ">=",
  lt: "<",
  lte: "<=",
  like: "LIKE",
  ilike: "ILIKE",
  in: "IN",
  is: "IS",
};

const IS_VALUES: Record<string, string> = {
  null: "NULL",
  not_null: "NOT NULL",
};

function parseCondition(
  condition: string,
  offset: number
): { sql: string; values: unknown[] } {
  const dotIndex = condition.indexOf(".");
  if (dotIndex === -1) {
    throw new Error(`Invalid condition format (expected field.op.value): ${condition}`);
  }

  const rest = condition.slice(dotIndex + 1);
  const opDotIndex = rest.indexOf(".");

  if (opDotIndex === -1) {
    throw new Error(`Invalid condition format (expected field.op.value): ${condition}`);
  }

  const column = condition.slice(0, dotIndex);
  const op = rest.slice(0, opDotIndex);
  const value = rest.slice(opDotIndex + 1);

  if (!isValidIdentifier(column)) {
    throw new Error(`Invalid column name: ${column}`);
  }

  const pgOp = OPERATORS[op];
  if (!pgOp) {
    throw new Error(
      `Unknown operator: ${op}. Valid: ${Object.keys(OPERATORS).join(", ")}`
    );
  }

  if (op === "in") {
    const inValues = value.split(",");
    const placeholders = inValues.map((_, i) => `$${offset + i + 1}`);
    return {
      sql: `"${column}" IN (${placeholders.join(", ")})`,
      values: inValues,
    };
  }

  if (op === "is") {
    const isTarget = IS_VALUES[value.toLowerCase()];
    if (!isTarget) {
      throw new Error(
        `Invalid value for "is" operator: "${value}". Valid values: null, not_null`
      );
    }
    return { sql: `"${column}" IS ${isTarget}`, values: [] };
  }

  return {
    sql: `"${column}" ${pgOp} $${offset + 1}`,
    values: [value],
  };
}

export function parseWhereConditions(
  conditions: string[],
  orConditions: string[] = []
): { sql: string; values: unknown[] } {
  const parts: string[] = [];
  const values: unknown[] = [];

  for (const condition of conditions) {
    const result = parseCondition(condition, values.length);
    parts.push(result.sql);
    values.push(...result.values);
  }

  if (orConditions.length > 0) {
    const orParts: string[] = [];
    for (const condition of orConditions) {
      const result = parseCondition(condition, values.length);
      orParts.push(result.sql);
      values.push(...result.values);
    }
    parts.push(`(${orParts.join(" OR ")})`);
  }

  return {
    sql: parts.length > 0 ? `WHERE ${parts.join(" AND ")}` : "",
    values,
  };
}

export function parseSelectColumns(select?: string): string {
  if (!select || select === "*") return "*";

  const columns = select.split(",").map((c) => c.trim());
  for (const col of columns) {
    if (!isValidIdentifier(col)) {
      throw new Error(`Invalid column name in select: ${col}`);
    }
  }
  return columns.map((c) => `"${c}"`).join(", ");
}

/**
 * Sıralama. C-01: PostgREST `order=col.asc.nullsfirst,col2.desc` multi desteklenir.
 * Legacy: sort=col&order=asc
 */
export function parseOrderBy(order?: string, sort?: string): string {
  if (!order && !sort) return "";

  if (sort) {
    const column = sort;
    const direction = (order ?? "asc").toUpperCase();
    if (!isValidIdentifier(column)) {
      throw new Error(`Invalid column name in order: ${column}`);
    }
    if (direction !== "ASC" && direction !== "DESC") {
      throw new Error(`Invalid order direction: "${direction}". Use asc or desc`);
    }
    return `ORDER BY "${column}" ${direction}`;
  }

  if (!order) return "";

  if (order === "asc" || order === "desc") {
    throw new Error(
      `Invalid order format: "${order}". Use "column.asc" or "column.desc", ` +
        `or use ?sort=column&order=asc separately.`
    );
  }

  const clauses = order.split(",").map((c) => c.trim()).filter(Boolean);
  const sqlClauses: string[] = [];

  for (const clause of clauses) {
    const parts = clause.split(".");
    if (parts.length < 2) {
      throw new Error(
        `Invalid order format: "${clause}". Use "column.asc" or "column.desc".`
      );
    }
    const column = parts[0];
    const direction = parts[1].toUpperCase();
    const nulls = parts[2]?.toLowerCase();

    if (!isValidIdentifier(column)) {
      throw new Error(`Invalid column name in order: ${column}`);
    }
    if (direction !== "ASC" && direction !== "DESC") {
      throw new Error(`Invalid order direction: "${parts[1]}". Use asc or desc`);
    }

    let sql = `"${column}" ${direction}`;
    if (nulls === "nullsfirst") sql += " NULLS FIRST";
    else if (nulls === "nullslast") sql += " NULLS LAST";
    else if (nulls) {
      throw new Error(
        `Invalid nulls ordering: "${parts[2]}". Use nullsfirst or nullslast`
      );
    }
    sqlClauses.push(sql);
  }

  return `ORDER BY ${sqlClauses.join(", ")}`;
}
