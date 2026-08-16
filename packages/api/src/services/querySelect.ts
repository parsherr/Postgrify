/**
 * Select list parser: E-17 aliases, E-19 JSON AS, E-20 aggregates, E-16 embeds.
 *
 * Embeds are returned as specs; call `attachEmbedSql` after FK resolution
 * to append correlated subqueries.
 */

import { isValidIdentifier } from "../utils/identifier.js";
import { splitCast, toColumnSql } from "./queryBuilder.js";
import {
  parseEmbedSpec,
  splitSelectTopLevel,
  type EmbedSpec,
} from "./queryEmbed.js";

const AGG_SQL: Record<string, string> = {
  sum: "SUM",
  avg: "AVG",
  count: "COUNT",
  min: "MIN",
  max: "MAX",
};

export interface ParsedSelect {
  /** SELECT list fragment (no leading SELECT) — may be incomplete until embeds attached */
  sql: string;
  /** "" or `GROUP BY ...` */
  groupBySql: string;
  hasAggregate: boolean;
  embeds: EmbedSpec[];
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

  // Infer JSON last-key AS (E-19) when no explicit alias
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

  const { base: castBase, cast: onlyCast } = splitCast(expr);
  if (onlyCast && isValidIdentifier(castBase)) {
    return {
      sql: `${colSql} AS "${castBase}"`,
      groupExpr: colSql,
      isAggregate: false,
    };
  }

  // E-19: auto-AS last JSON key
  if (!isValidIdentifier(castBase)) {
    const textKey = castBase.match(/->>'([a-zA-Z_][a-zA-Z0-9_]*)'$/);
    const objKey = castBase.match(/->'([a-zA-Z_][a-zA-Z0-9_]*)'$/);
    const idx = castBase.match(/->(\d+)$/);
    const auto = textKey?.[1] ?? objKey?.[1] ?? idx?.[1] ?? null;
    if (auto) {
      return {
        sql: `${colSql} AS "${auto}"`,
        groupExpr: colSql,
        isAggregate: false,
      };
    }
  }

  return {
    sql: colSql,
    groupExpr: colSql,
    isAggregate: false,
  };
}

/**
 * Parse select= into SQL + optional GROUP BY + embed specs (E-16/E-20).
 */
export function parseSelect(select?: string): ParsedSelect {
  if (!select || select === "*") {
    return { sql: "*", groupBySql: "", hasAggregate: false, embeds: [] };
  }

  const columns = splitSelectTopLevel(select);
  if (columns.length === 0) {
    return { sql: "*", groupBySql: "", hasAggregate: false, embeds: [] };
  }

  const embeds: EmbedSpec[] = [];
  const parts: SelectPart[] = [];
  let hasStar = false;

  for (const col of columns) {
    if (col === "*") {
      hasStar = true;
      parts.push({ sql: "*", groupExpr: null, isAggregate: false });
      continue;
    }

    const embed = parseEmbedSpec(col);
    if (embed) {
      embeds.push(embed);
      continue;
    }

    parts.push(parseSelectItem(col));
  }

  if (hasStar && parts.some((p) => p.sql !== "*")) {
    throw new Error('Cannot mix "*" with other select columns');
  }

  const hasAggregate = parts.some((p) => p.isAggregate);

  if (hasAggregate && hasStar) {
    throw new Error("Cannot use * with aggregate functions in select");
  }

  if (hasAggregate && embeds.length > 0) {
    throw new Error(
      "Cannot combine aggregate functions and embedded resources in the same select"
    );
  }

  if (!hasAggregate) {
    return {
      sql: parts.map((p) => p.sql).join(", "),
      groupBySql: "",
      hasAggregate: false,
      embeds,
    };
  }

  const groupExprs = parts
    .filter((p) => p.groupExpr !== null)
    .map((p) => p.groupExpr as string);

  const seen = new Set<string>();
  const unique: string[] = [];
  for (const g of groupExprs) {
    if (seen.has(g)) continue;
    seen.add(g);
    unique.push(g);
  }

  const groupBySql =
    unique.length > 0 ? `GROUP BY ${unique.join(", ")}` : "";

  return {
    sql: parts.map((p) => p.sql).join(", "),
    groupBySql,
    hasAggregate: true,
    embeds,
  };
}

/**
 * Append resolved embed subquery fragments to a parsed select list.
 */
export function attachEmbedSql(
  parsed: ParsedSelect,
  embedSqlFragments: string[]
): ParsedSelect {
  if (embedSqlFragments.length === 0) return parsed;
  const parts: string[] = [];
  if (parsed.sql) parts.push(parsed.sql);
  parts.push(...embedSqlFragments);
  const sql = parts.length > 0 ? parts.join(", ") : "*";
  return { ...parsed, sql };
}

/** Backward-compatible SELECT list only (no embed SQL attached). */
export function parseSelectColumns(select?: string): string {
  const parsed = parseSelect(select);
  if (parsed.embeds.length > 0) {
    throw new Error(
      "select contains embeds; use parseSelect + attachEmbedSql with a parent table"
    );
  }
  return parsed.sql;
}
