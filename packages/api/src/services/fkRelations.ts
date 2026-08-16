/**
 * E-16: Foreign-key relation discovery for resource embedding.
 *
 * Loads public-schema FKs and resolves parent↔embed direction:
 *   many-to-one — parent has FK → embed (object / null)
 *   one-to-many — embed has FK → parent (json array)
 *
 * Hint (`!column` or `!constraint_name`) disambiguates multiple FKs.
 */

export interface FkEdge {
  constraintName: string;
  fromTable: string;
  fromColumn: string;
  toTable: string;
  toColumn: string;
}

export type RelationDirection = "many-to-one" | "one-to-many";

export interface ResolvedRelation {
  direction: RelationDirection;
  /** Column on the parent (root) table */
  parentColumn: string;
  /** Column on the embedded table */
  embedColumn: string;
  constraintName: string;
}

type SqlClient = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  unsafe: (query: string, params?: any[]) => Promise<any[]>;
};

const FK_CACHE = new Map<string, { at: number; edges: FkEdge[] }>();
const FK_CACHE_TTL_MS = 60_000;

export async function loadForeignKeys(
  sql: SqlClient,
  database: string,
  schema = "public"
): Promise<FkEdge[]> {
  const cacheKey = `${database}:${schema}`;
  const hit = FK_CACHE.get(cacheKey);
  if (hit && Date.now() - hit.at < FK_CACHE_TTL_MS) {
    return hit.edges;
  }

  const rows = await sql.unsafe(
    `
    SELECT
      tc.constraint_name AS "constraintName",
      tc.table_name AS "fromTable",
      kcu.column_name AS "fromColumn",
      ccu.table_name AS "toTable",
      ccu.column_name AS "toColumn"
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
     AND tc.table_schema = kcu.table_schema
    JOIN information_schema.referential_constraints rc
      ON tc.constraint_name = rc.constraint_name
     AND tc.table_schema = rc.constraint_schema
    JOIN information_schema.constraint_column_usage ccu
      ON rc.unique_constraint_name = ccu.constraint_name
     AND rc.unique_constraint_schema = ccu.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_schema = $1
    ORDER BY tc.table_name, tc.constraint_name, kcu.ordinal_position
    `,
    [schema]
  );

  const edges: FkEdge[] = rows.map((r: FkEdge) => ({
    constraintName: String(r.constraintName),
    fromTable: String(r.fromTable),
    fromColumn: String(r.fromColumn),
    toTable: String(r.toTable),
    toColumn: String(r.toColumn),
  }));

  FK_CACHE.set(cacheKey, { at: Date.now(), edges });
  return edges;
}

/** Test helper — clear relation cache. */
export function clearFkCache(): void {
  FK_CACHE.clear();
}

function matchesHint(edge: FkEdge, hint: string | null): boolean {
  if (!hint) return true;
  return (
    edge.fromColumn === hint ||
    edge.toColumn === hint ||
    edge.constraintName === hint
  );
}

/**
 * Resolve how `embedTable` relates to `parentTable`.
 */
export function resolveRelation(
  edges: FkEdge[],
  parentTable: string,
  embedTable: string,
  hint: string | null = null
): ResolvedRelation {
  const forward = edges.filter(
    (e) =>
      e.fromTable === parentTable &&
      e.toTable === embedTable &&
      matchesHint(e, hint)
  );
  const reverse = edges.filter(
    (e) =>
      e.fromTable === embedTable &&
      e.toTable === parentTable &&
      matchesHint(e, hint)
  );

  const candidates: ResolvedRelation[] = [
    ...forward.map((e) => ({
      direction: "many-to-one" as const,
      parentColumn: e.fromColumn,
      embedColumn: e.toColumn,
      constraintName: e.constraintName,
    })),
    ...reverse.map((e) => ({
      direction: "one-to-many" as const,
      parentColumn: e.toColumn,
      embedColumn: e.fromColumn,
      constraintName: e.constraintName,
    })),
  ];

  if (candidates.length === 0) {
    const hintMsg = hint ? ` (hint: ${hint})` : "";
    throw new Error(
      `No foreign key between "${parentTable}" and "${embedTable}"${hintMsg}`
    );
  }

  if (candidates.length > 1) {
    const detail = candidates
      .map(
        (c) =>
          `${c.direction} via ${c.constraintName} (${c.parentColumn}↔${c.embedColumn})`
      )
      .join("; ");
    throw new Error(
      `Ambiguous relationship between "${parentTable}" and "${embedTable}". ` +
        `Disambiguate with !column or !constraint_name. Candidates: ${detail}`
    );
  }

  return candidates[0];
}
