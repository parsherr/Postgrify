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
 */

import { isValidIdentifier } from "../utils/identifier.js";

export interface SelectOptions {
  select?: string;   // "id,name,email"
  where?: string[];  // ["age.gt.18", "status.eq.active"]
  or?: string[];     // ["role.eq.admin", "role.eq.mod"] → OR ile birleştirilir
  order?: string;    // "created_at.desc" (birleşik) VEYA yalnızca yön ("desc") — sort ile birlikte
  sort?: string;     // "created_at" — order="desc" ile birlikte kullanılır
  limit?: number;
  offset?: number;
}

export interface WhereClause {
  sql: string;
  values: unknown[];
}

// `not` kaldırıldı — `neq` alias'ı olarak davranıyordu ama değer yok sayılıyordu.
// `neq` kullanın: field.neq.value
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

// `is` operatörünün kabul ettiği değerler
const IS_VALUES: Record<string, string> = {
  null: "NULL",
  not_null: "NOT NULL",
};

/**
 * Tek bir "field.op.value" string'ini parse ederek SQL parçası ve değer üretir.
 * Değerler values dizisine offset kadar kaydırılmış placeholder ile eklenir.
 */
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
    // IS NULL / IS NOT NULL — değer parametrize edilmez
    return { sql: `"${column}" IS ${isTarget}`, values: [] };
  }

  // Standart operatörler
  return {
    sql: `"${column}" ${pgOp} $${offset + 1}`,
    values: [value],
  };
}

/**
 * WHERE koşullarını parse eder.
 *
 * @param conditions AND ile birleştirilecek koşullar: ["age.gt.18", "status.eq.active"]
 * @param orConditions OR ile birleştirilecek koşullar: ["role.eq.admin", "role.eq.mod"]
 *
 * Üretilen SQL: WHERE "age" > $1 AND "status" = $2 AND ("role" = $3 OR "role" = $4)
 */
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
    // OR grubunu parantez içine al — AND ile karışmasın
    parts.push(`(${orParts.join(" OR ")})`);
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
 * Sıralama ifadesi oluşturur. İki kullanım biçimi:
 *
 * 1. Birleşik format:  parseOrderBy("created_at.desc")
 * 2. Ayrı format:      parseOrderBy("desc", "created_at")
 *    — sort=created_at&order=desc (Supabase/PostgREST uyumlu)
 *
 * @param order  "column.direction" veya yalnızca yön ("asc"|"desc")
 * @param sort   Kolon adı (order yalnızca yön içerdiğinde kullanılır)
 */
export function parseOrderBy(order?: string, sort?: string): string {
  if (!order && !sort) return "";

  let column: string;
  let direction: string;

  if (sort) {
    // Ayrı format: sort=created_at&order=desc
    column = sort;
    direction = (order ?? "asc").toUpperCase();
  } else if (order) {
    const lastDot = order.lastIndexOf(".");
    if (lastDot === -1) {
      // Sadece yön verilmiş ama sort yok — geçersiz, boş döndür
      throw new Error(
        `Invalid order format: "${order}". Use "column.asc" or "column.desc", ` +
        `or use ?sort=column&order=asc separately.`
      );
    }
    column = order.slice(0, lastDot);
    direction = order.slice(lastDot + 1).toUpperCase();
  } else {
    return "";
  }

  if (!isValidIdentifier(column)) {
    throw new Error(`Invalid column name in order: ${column}`);
  }

  if (direction !== "ASC" && direction !== "DESC") {
    throw new Error(`Invalid order direction: "${direction}". Use asc or desc`);
  }

  return `ORDER BY "${column}" ${direction}`;
}