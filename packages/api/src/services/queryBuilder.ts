/**
 * Query Builder — Gelen HTTP parametrelerini güvenli PostgreSQL sorgularına dönüştürür.
 *
 * Tüm değerler parametrik ($1, $2, ...) olarak geçirilir — SQL injection imkânsız.
 * Tablo ve kolon adları isValidIdentifier() ile validate edilir.
 *
 * Desteklenen operatörler:
 *   eq, neq, gt, gte, lt, lte, like, ilike, in, is, not
 */

import { isValidIdentifier } from "../utils/identifier.js";

export interface SelectOptions {
  select?: string;   // "id,name,email"
  where?: string[];  // ["age.gt.18", "status.eq.active"]
  order?: string;    // "name.asc" | "created_at.desc"
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
  not: "IS NOT",
};

/**
 * "age.gt.18" → { sql: '"age" > $1', values: [18] }
 */
export function parseWhereConditions(
  conditions: string[]
): { sql: string; values: unknown[] } {
  const parts: string[] = [];
  const values: unknown[] = [];

  for (const condition of conditions) {
    const dotIndex = condition.indexOf(".");
    const rest = condition.slice(dotIndex + 1);
    const opDotIndex = rest.indexOf(".");

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
      const placeholders = inValues.map((_, i) => `$${values.length + i + 1}`);
      parts.push(`"${column}" IN (${placeholders.join(", ")})`);
      values.push(...inValues);
    } else if (op === "is") {
      // "field.is.null" → field IS NULL (değer yok)
      parts.push(`"${column}" IS ${value.toUpperCase() === "NULL" ? "NULL" : "NOT NULL"}`);
    } else if (op === "not") {
      parts.push(`"${column}" IS NOT NULL`);
    } else {
      parts.push(`"${column}" ${pgOp} $${values.length + 1}`);
      values.push(value);
    }
  }

  return {
    sql: parts.length > 0 ? `WHERE ${parts.join(" AND ")}` : "",
    values,
  };
}

/**
 * SELECT kolon listesini parse eder. "*" veya boş → tüm kolonlar.
 */
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
 * "name.asc" veya "created_at.desc" → ORDER BY "name" ASC
 */
export function parseOrderBy(order?: string): string {
  if (!order) return "";

  const lastDot = order.lastIndexOf(".");
  const column = order.slice(0, lastDot);
  const direction = order.slice(lastDot + 1).toUpperCase();

  if (!isValidIdentifier(column)) {
    throw new Error(`Invalid column name in order: ${column}`);
  }

  if (direction !== "ASC" && direction !== "DESC") {
    throw new Error(`Invalid order direction: ${direction}. Use asc or desc`);
  }

  return `ORDER BY "${column}" ${direction}`;
}