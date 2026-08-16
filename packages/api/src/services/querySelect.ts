/**
 * E-20: select list parser with aggregates + automatic GROUP BY.
 *
 *   select=status,total:amount.sum(),n:id.count()
 *   select=category,avg_price:price.avg()::int
 *   select=amount.sum()
 *   select=count()
 *
 * Non-aggregate columns are GROUP BY'd when any aggregate is present.
 * Alias uses first `:` that is not part of `::` cast (same rule as E-17).
 */

import { isValidIdentifier } from "../utils/identifier.js";
import { splitCast, toColumnSql } from "./queryBuilder.js";

const AGG_SQL: Record<string, string> = {
  sum: "SUM",
  avg: "AVG",
  count: "COUNT",
  min: "MIN",
  max: "MAX",
};

export interface ParsedSelect {
  /** SELECT list fragment (no leading SELECT) */
  sql: string;
  /** "" or `GROUP BY ...` */
  groupBySql: string;
  hasAggregate: boolean;
}

function findAliasColon(item: string): number {
  for (let i = 0; i < item.length; i++) {
    if (item[i] !== ":") continue;
    if (item[i + 1] === ":") {
      i += 1;
      continue;
    }
    return i;
  }
  return -1;
}

interface SelectPart {
  sql: string;
  /** Expression to GROUP BY (null for aggregates) */
  groupExpr: string | null;
  isAggregate: boolean;
}

function parseAggregateBase(
  base: string,
  cast: string | null,
  alias: string | null
): SelectPart | null {
  if (base === "count()") {
    let sql = "COUNT(*)";
    if (cast) sql = `(${sql})::${cast}`;
    const asName = alias ?? "count";
    return {
      sql: `${sql} AS "${asName}"`,
      groupExpr: null,
      isAggregate: true,
    };
  }

  const m = base.match(/^(.+)\.(sum|avg|count|min|max)\(\)$/i);
  if (!m) return null;

  const colExpr = m[1];
  const fn = m[2].toLowerCase();
  const agg = AGG_SQL[fn];
  if (!agg) {
    throw new Error(`Unsupported aggregate: ${fn}`);
  }

  let colSql: string;
  try {
    colSql = toColumnSql(colExpr);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/Invalid cast/i.test(msg)) throw e;
    throw new Error(`Invalid aggregate column: ${colExpr}`);
  }

  let sql = `${agg}(${colSql})`;
  if (cast) sql = `(${sql})::${cast}`;
  const asName = alias ?? fn;
  return {
    sql: `${sql} AS "${asName}"`,
    groupExpr: null,
    isAggregate: true,
  };
}

function parseSelectItem(item: string): SelectPart {
  let alias: string | null = null;
  let expr = item;

  const colonIdx = findAliasColon(item);
  if (colonIdx !== -1) {
    alias = item.slice(0, colonIdx);
    expr = item.slice(colonIdx + 1);
    if (!alias || !isValidIdentifier(alias)) {
      throw new Error(`Invalid select alias: ${alias ?? "(empty)"}`);
    }
    if (!expr) {
      throw new Error(`Invalid select expression after alias: ${item}`);
    }
  }

  const { base, cast } = splitCast(expr);
  const agg = parseAggregateBase(base, cast, alias);
  if (agg) return agg;

  let colSql: string;
  try {
    colSql = toColumnSql(expr);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/Invalid cast/i.test(msg)) throw e;
    throw new Error(`Invalid column name in select: ${item}`);
  }

  if (alias) {
    return {
      sql: `${colSql} AS "${alias}"`,
      groupExpr: colSql,
      isAggregate: false,
    };
  }

  // Cast-only select keeps a stable response key (base identifier).
  const { base: castBase, cast: onlyCast } = splitCast(expr);
  if (onlyCast && isValidIdentifier(castBase)) {
    return {
      sql: `${colSql} AS "${castBase}"`,
      groupExpr: colSql,
      isAggregate: false,
    };
  }

  return {
    sql: colSql,
    groupExpr: colSql,
    isAggregate: false,
  };
}

/**
 * Parse select= into SQL + optional GROUP BY (E-20).
 */
export function parseSelect(select?: string): ParsedSelect {
  if (!select || select === "*") {
    return { sql: "*", groupBySql: "", hasAggregate: false };
  }

  const columns = select.split(",").map((c) => c.trim()).filter(Boolean);
  if (columns.length === 0) {
    return { sql: "*", groupBySql: "", hasAggregate: false };
  }

  if (columns.some((c) => c === "*") && columns.length > 1) {
    throw new Error('Cannot mix "*" with other select columns');
  }

  const parts = columns.map(parseSelectItem);
  const hasAggregate = parts.some((p) => p.isAggregate);

  if (hasAggregate && parts.some((p) => p.sql === "*")) {
    throw new Error("Cannot use * with aggregate functions in select");
  }

  const sql = parts.map((p) => p.sql).join(", ");

  if (!hasAggregate) {
    return { sql, groupBySql: "", hasAggregate: false };
  }

  const groupExprs = parts
    .filter((p) => p.groupExpr !== null)
    .map((p) => p.groupExpr as string);

  // Deduplicate while preserving order
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const g of groupExprs) {
    if (seen.has(g)) continue;
    seen.add(g);
    unique.push(g);
  }

  const groupBySql =
    unique.length > 0 ? `GROUP BY ${unique.join(", ")}` : "";

  return { sql, groupBySql, hasAggregate: true };
}

/** Backward-compatible SELECT list only. */
export function parseSelectColumns(select?: string): string {
  return parseSelect(select).sql;
}
