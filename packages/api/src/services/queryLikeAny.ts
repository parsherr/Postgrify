/**
 * E-13 — like(any|all) / ilike(any|all) pattern lists.
 *
 * PostgREST: last_name=like(any).{Smith*,Jones*}
 * Postgrify where: last_name.like(any).{Smith*,Jones*}
 *
 * `*` in patterns becomes SQL `%` (PostgREST wildcard). Patterns are always
 * bound as parameters — never concatenated into SQL.
 */

/**
 * Parse `{pat1,pat2}` for LIKE/ILIKE lists.
 * Allows `*` `?` `%` `_` in unquoted tokens; maps `*` → `%` and `?` → `_`.
 */
export function parseBracePatterns(value: string): string[] {
  if (!value.startsWith("{") || !value.endsWith("}")) {
    throw new Error(
      `like(any|all) expects {pattern,pattern}, got: ${value}`
    );
  }

  const inner = value.slice(1, -1);
  if (inner.length === 0) {
    throw new Error("Empty like(any|all) pattern list");
  }

  const elements: string[] = [];
  let i = 0;
  while (i < inner.length) {
    while (i < inner.length && /\s/.test(inner[i])) i++;
    if (i >= inner.length) break;

    if (inner[i] === '"') {
      i++;
      let buf = "";
      while (i < inner.length && inner[i] !== '"') {
        if (inner[i] === "\\" && i + 1 < inner.length) {
          buf += inner[i + 1];
          i += 2;
          continue;
        }
        buf += inner[i];
        i++;
      }
      if (i >= inner.length || inner[i] !== '"') {
        throw new Error("Unterminated quoted like pattern");
      }
      i++;
      elements.push(buf);
    } else {
      const start = i;
      while (i < inner.length && inner[i] !== ",") i++;
      const raw = inner.slice(start, i).trim();
      if (raw === "") {
        throw new Error("Empty like pattern element");
      }
      // Allow wildcards * ? % _ ; reject SQL metacharacters
      if (/[{}\[\]();"'`]|--|\/\*|\0/.test(raw)) {
        throw new Error(`Invalid like pattern: ${raw}`);
      }
      elements.push(raw);
    }

    while (i < inner.length && /\s/.test(inner[i])) i++;
    if (i < inner.length) {
      if (inner[i] !== ",") {
        throw new Error(`Invalid like pattern list near: ${inner.slice(i)}`);
      }
      i++;
    }
  }

  if (elements.length === 0) {
    throw new Error("Empty like(any|all) pattern list");
  }

  return elements.map((p) => p.replace(/\*/g, "%").replace(/\?/g, "_"));
}

export type LikeQuantifier = "any" | "all";
export type LikeKind = "like" | "ilike";

/**
 * Build `(col LIKE $1 OR col LIKE $2)` / AND / ILIKE variants.
 */
export function buildLikeAnyAllClause(
  columnSql: string,
  kind: LikeKind,
  quantifier: LikeQuantifier,
  braceValue: string,
  paramOffset: number
): { sql: string; values: unknown[] } {
  const patterns = parseBracePatterns(braceValue);
  const sqlOp = kind === "ilike" ? "ILIKE" : "LIKE";
  const joiner = quantifier === "all" ? " AND " : " OR ";

  const parts = patterns.map(
    (_, i) => `${columnSql} ${sqlOp} $${paramOffset + i + 1}`
  );

  return {
    sql: `(${parts.join(joiner)})`,
    values: patterns,
  };
}

/** Match rest starting with like(any).{...} / ilike(all).{...} */
export function matchLikeAnyAll(
  rest: string
): { kind: LikeKind; quantifier: LikeQuantifier; value: string } | null {
  const m = rest.match(/^(like|ilike)\((any|all)\)\.(.+)$/);
  if (!m) return null;
  return {
    kind: m[1] as LikeKind,
    quantifier: m[2] as LikeQuantifier,
    value: m[3],
  };
}
