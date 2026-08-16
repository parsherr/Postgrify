/**
 * Query Builder — Gelen HTTP parametrelerini güvenli PostgreSQL sorgularına dönüştürür.
 *
 * Tüm değerler parametrik ($1, $2, ...) olarak geçirilir — SQL injection imkânsız.
 * Tablo ve kolon adları isValidIdentifier() ile validate edilir.
 *
 * Desteklenen operatörler (where ve or param'larında):
 *   eq, neq, gt, gte, lt, lte, like, ilike, in, is
 *   FTS (E-11): fts, plfts, phfts, wfts — optional lang: plfts(turkish)
 *   JSONB (E-14): settings->>'theme'.eq.dark , attrs->'specs'->>'weight'.lt.5
 *   Cast (E-18): col::numeric , settings->>'n'::float — allowlisted types only
 *   Array/range (E-12): tags.cs.{a,b} , schedule.ov.[2026-01-01,2026-06-01]
 *   like(any|all) (E-13): name.like(any).{A*,B*} , title.ilike(all).{*x*,*y*}
 *
 * OR desteği:
 *   ?where=status.eq.active&or=role.eq.admin,role.eq.mod
 *   → WHERE "status" = 'active' AND ("role" = 'admin' OR "role" = 'mod')
 *
 * `is` operatörü değerleri:
 *   field.is.null     → "field" IS NULL
 *   field.is.not_null → "field" IS NOT NULL
 *
 * Sıralama — iki format desteklenir:
 *   ?order=created_at.desc         (birleşik format)
 *   ?sort=created_at&order=desc    (ayrı format — Supabase/PostgREST uyumlu)
 */

import { isValidIdentifier } from "../utils/identifier.js";
import {
  buildArrayRangeClause,
  isArrayRangeOp,
  ARRAY_RANGE_OPS,
} from "./queryArrayRange.js";
import {
  buildLikeAnyAllClause,
  matchLikeAnyAll,
} from "./queryLikeAny.js";

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

const FTS_FUNCS: Record<string, string> = {
  fts: "to_tsquery",
  plfts: "plainto_tsquery",
  phfts: "phraseto_tsquery",
  wfts: "websearch_to_tsquery",
};

const FTS_LANG_RE = /^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/;

const IS_VALUES: Record<string, string> = {
  null: "NULL",
  not_null: "NOT NULL",
};

/** E-18: allowlisted PostgreSQL types for ::cast (never user-arbitrary). */
const ALLOWED_CASTS = new Set([
  "text",
  "int",
  "int2",
  "int4",
  "int8",
  "integer",
  "bigint",
  "smallint",
  "float4",
  "float8",
  "float",
  "real",
  "numeric",
  "decimal",
  "bool",
  "boolean",
  "json",
  "jsonb",
  "uuid",
  "date",
  "time",
  "timestamp",
  "timestamptz",
]);

/**
 * Split optional ::type suffix. Type must be in ALLOWED_CASTS.
 */
function splitCast(expr: string): { base: string; cast: string | null } {
  const m = expr.match(/^(.*)::([a-zA-Z_][a-zA-Z0-9_]*)$/);
  if (!m) return { base: expr, cast: null };
  const cast = m[2].toLowerCase();
  if (!ALLOWED_CASTS.has(cast)) {
    throw new Error(
      `Invalid cast type: ${m[2]}. Allowed: ${[...ALLOWED_CASTS].join(", ")}`
    );
  }
  if (!m[1]) {
    throw new Error(`Invalid cast expression: ${expr}`);
  }
  return { base: m[1], cast };
}

/**
 * E-14 + E-18: Safe SQL expression for a column / JSON path / optional ::cast.
 *
 * Allowed: name | settings->>'theme' | attrs->'specs'->>'weight' | data->0->>'name'
 *          name::text | attrs->'specs'->>'weight'::numeric
 * Keys: [a-zA-Z_][a-zA-Z0-9_]* only. Indexes: non-negative integers.
 */
export function toColumnSql(columnExpr: string): string {
  const { base, cast } = splitCast(columnExpr);

  let sql: string;
  if (isValidIdentifier(base)) {
    sql = `"${base}"`;
  } else {
    const rootMatch = base.match(
      /^([a-zA-Z_][a-zA-Z0-9_]{0,62})((?:->|->>).+)$/
    );
    if (!rootMatch) {
      throw new Error(`Invalid column name: ${columnExpr}`);
    }

    const root = rootMatch[1];
    if (!isValidIdentifier(root)) {
      throw new Error(`Invalid column name: ${root}`);
    }

    let rest = rootMatch[2];
    sql = `"${root}"`;

    while (rest.length > 0) {
      const seg = rest.match(
        /^(->>|->)(?:'([a-zA-Z_][a-zA-Z0-9_]{0,62})'|(\d+))(.*)$/
      );
      if (!seg) {
        throw new Error(`Invalid JSON path segment in: ${columnExpr}`);
      }
      const arrow = seg[1];
      const key = seg[2];
      const index = seg[3];
      rest = seg[4];
      if (key !== undefined) {
        sql += `${arrow}'${key}'`;
      } else {
        sql += `${arrow}${index}`;
      }
    }
  }

  // Parenthesize before cast so JSON ->> result is cast, not the key literal.
  return cast ? `(${sql})::${cast}` : sql;
}

/**
 * Split field.op.value where field may be a JSON path (no bare dots in keys).
 * Finds the `.op.` that starts a known operator (or FTS op with optional lang).
 */
function splitFieldAndRest(condition: string): { field: string; rest: string } {
  const opStart =
    /(?:^|\.)((?:fts|plfts|phfts|wfts)(?:\([a-zA-Z_][a-zA-Z0-9_]{0,62}\))?|(?:i?like)\((?:any|all)\)|eq|neq|gt|gte|lt|lte|like|ilike|in|is|cs|cd|ov|sl|sr|nxl|nxr|adj)\./g;

  let match: RegExpExecArray | null;
  let last: RegExpExecArray | null = null;
  while ((match = opStart.exec(condition)) !== null) {
    last = match;
  }

  if (!last) {
    const dotIndex = condition.indexOf(".");
    if (dotIndex === -1) {
      throw new Error(
        `Invalid condition format (expected field.op.value): ${condition}`
      );
    }
    return {
      field: condition.slice(0, dotIndex),
      rest: condition.slice(dotIndex + 1),
    };
  }

  const at = last.index;
  if (condition[at] === ".") {
    return {
      field: condition.slice(0, at),
      rest: condition.slice(at + 1),
    };
  }
  return {
    field: condition.slice(0, at),
    rest: condition.slice(at),
  };
}

function parseFtsCondition(
  columnSql: string,
  rest: string,
  offset: number
): { sql: string; values: unknown[] } | null {
  const match = rest.match(
    /^(fts|plfts|phfts|wfts)(?:\(([a-zA-Z_][a-zA-Z0-9_]{0,62})\))?\.(.*)$/
  );
  if (!match) return null;

  const kind = match[1];
  const lang = match[2];
  const rawQuery = match[3];
  const fn = FTS_FUNCS[kind];
  if (!fn) return null;

  if (!rawQuery || rawQuery.trim() === "") {
    throw new Error(`Empty FTS query for operator "${kind}"`);
  }

  if (lang) {
    if (!FTS_LANG_RE.test(lang)) {
      throw new Error(`Invalid FTS language config: ${lang}`);
    }
    return {
      sql: `${columnSql} @@ ${fn}($${offset + 1}::regconfig, $${offset + 2})`,
      values: [lang, rawQuery],
    };
  }

  return {
    sql: `${columnSql} @@ ${fn}($${offset + 1})`,
    values: [rawQuery],
  };
}

function parseCondition(
  condition: string,
  offset: number
): { sql: string; values: unknown[] } {
  const { field: columnExpr, rest } = splitFieldAndRest(condition);
  const columnSql = toColumnSql(columnExpr);

  const fts = parseFtsCondition(columnSql, rest, offset);
  if (fts) return fts;

  const likeAny = matchLikeAnyAll(rest);
  if (likeAny) {
    return buildLikeAnyAllClause(
      columnSql,
      likeAny.kind,
      likeAny.quantifier,
      likeAny.value,
      offset
    );
  }

  const opDotIndex = rest.indexOf(".");
  if (opDotIndex === -1) {
    throw new Error(
      `Invalid condition format (expected field.op.value): ${condition}`
    );
  }

  const op = rest.slice(0, opDotIndex);
  const value = rest.slice(opDotIndex + 1);

  if (isArrayRangeOp(op)) {
    return buildArrayRangeClause(columnSql, op, value, offset);
  }

  const pgOp = OPERATORS[op];
  if (!pgOp) {
    throw new Error(
      `Unknown operator: ${op}. Valid: ${Object.keys(OPERATORS).join(", ")}, ` +
        `${Object.keys(FTS_FUNCS).join(", ")}, ` +
        `${Object.keys(ARRAY_RANGE_OPS).join(", ")}, ` +
        `like(any|all), ilike(any|all)`
    );
  }

  if (op === "in") {
    const inValues = value.split(",");
    const placeholders = inValues.map((_, i) => `$${offset + i + 1}`);
    return {
      sql: `${columnSql} IN (${placeholders.join(", ")})`,
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
    return { sql: `${columnSql} IS ${isTarget}`, values: [] };
  }

  return {
    sql: `${columnSql} ${pgOp} $${offset + 1}`,
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

  const columns = select.split(",").map((c) => c.trim()).filter(Boolean);
  const parts: string[] = [];
  for (const col of columns) {
    try {
      parts.push(toColumnSql(col));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // Preserve cast validation wording (E-18); otherwise generic select error.
      if (/Invalid cast/i.test(msg)) throw e;
      throw new Error(`Invalid column name in select: ${col}`);
    }
  }
  return parts.join(", ");
}

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
