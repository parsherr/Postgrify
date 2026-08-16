/**
 * E-16: Build correlated subquery SQL for embedded resources.
 *
 * many-to-one → row_to_json / null
 * one-to-many → json_agg / []
 */

import { isValidIdentifier } from "../utils/identifier.js";
import {
  loadForeignKeys,
  resolveRelation,
  type FkEdge,
  type ResolvedRelation,
} from "./fkRelations.js";
import type { EmbedColumn, EmbedSpec } from "./queryEmbed.js";

type SqlClient = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  unsafe: (query: string, params?: any[]) => Promise<any[]>;
};

const MAX_EMBED_DEPTH = 2;

function qIdent(name: string): string {
  if (!isValidIdentifier(name)) {
    throw new Error(`Invalid identifier in embed: ${name}`);
  }
  return `"${name}"`;
}

function embedSelectList(
  embedAlias: string,
  spec: EmbedSpec,
  edges: FkEdge[],
  depth: number
): string {
  if (spec.star) {
    return `${qIdent(embedAlias)}.*`;
  }

  const parts: string[] = [];
  for (const col of spec.columns) {
    if (col.kind === "column" && col.name) {
      parts.push(`${qIdent(embedAlias)}.${qIdent(col.name)}`);
      continue;
    }
    if (col.kind === "embed" && col.embed) {
      if (depth >= MAX_EMBED_DEPTH) {
        throw new Error(
          `Embed nesting too deep (max ${MAX_EMBED_DEPTH}). Simplify select.`
        );
      }
      parts.push(
        buildEmbedSubquery(
          col.embed,
          spec.table,
          embedAlias,
          edges,
          depth + 1
        )
      );
      continue;
    }
    throw new Error("Invalid embed column");
  }
  if (parts.length === 0) {
    throw new Error(`Embed ${spec.table}(...) has no columns`);
  }
  return parts.join(", ");
}

/**
 * Correlated subquery expression: (... ) AS "alias"
 * `parentAlias` is the SQL alias/name of the parent row source.
 */
export function buildEmbedSubquery(
  spec: EmbedSpec,
  parentTable: string,
  parentAlias: string,
  edges: FkEdge[],
  depth = 1
): string {
  const rel: ResolvedRelation = resolveRelation(
    edges,
    parentTable,
    spec.table,
    spec.hint
  );

  const childAlias = `_e${depth}_${spec.alias}`;
  const selectList = embedSelectList(childAlias, spec, edges, depth);

  const joinSql = `${qIdent(childAlias)}.${qIdent(rel.embedColumn)} = ${qIdent(parentAlias)}.${qIdent(rel.parentColumn)}`;

  if (rel.direction === "many-to-one") {
    return `(
      SELECT row_to_json(_emb)
      FROM (
        SELECT ${selectList}
        FROM ${qIdent(spec.table)} AS ${qIdent(childAlias)}
        WHERE ${joinSql}
        LIMIT 1
      ) AS _emb
    ) AS ${qIdent(spec.alias)}`;
  }

  return `(
    SELECT COALESCE(json_agg(row_to_json(_emb)), '[]'::json)
    FROM (
      SELECT ${selectList}
      FROM ${qIdent(spec.table)} AS ${qIdent(childAlias)}
      WHERE ${joinSql}
    ) AS _emb
  ) AS ${qIdent(spec.alias)}`;
}

export async function buildEmbedSelectFragments(
  sql: SqlClient,
  database: string,
  parentTable: string,
  embeds: EmbedSpec[]
): Promise<string[]> {
  if (embeds.length === 0) return [];
  const edges = await loadForeignKeys(sql, database);
  return embeds.map((spec) =>
    buildEmbedSubquery(spec, parentTable, parentTable, edges, 1)
  );
}

/** Expose for unit tests without DB. */
export function buildEmbedSelectFragmentsSync(
  parentTable: string,
  embeds: EmbedSpec[],
  edges: FkEdge[]
): string[] {
  return embeds.map((spec) =>
    buildEmbedSubquery(spec, parentTable, parentTable, edges, 1)
  );
}
