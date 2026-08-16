/**
 * E-15: PostgREST-style nested or/and/not logic trees.
 *
 * Examples:
 *   (age.lt.18,age.gt.65)
 *   and=(status.eq.pending,total.gt.100)
 *   or=(status.eq.pending,and=(total.gt.100,customer_id.eq.5))
 *   not.and=(price.lt.10,stock.eq.0)
 */

export type AtomParser = (
  condition: string,
  offset: number
) => { sql: string; values: unknown[] };

export const MAX_LOGIC_DEPTH = 8;

/**
 * Split on commas that are not inside parentheses.
 */
export function splitTopLevelCommas(input: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ch === "(") depth += 1;
    else if (ch === ")") {
      depth -= 1;
      if (depth < 0) {
        throw new Error(`Unbalanced parentheses in logic expression: ${input}`);
      }
    } else if (ch === "," && depth === 0) {
      parts.push(input.slice(start, i));
      start = i + 1;
    }
  }
  if (depth !== 0) {
    throw new Error(`Unbalanced parentheses in logic expression: ${input}`);
  }
  parts.push(input.slice(start));
  return parts;
}

/**
 * If the whole string is wrapped in matching `(...)`, return the inside.
 */
export function unwrapOuterParens(input: string): string {
  const s = input.trim();
  if (!s.startsWith("(") || !s.endsWith(")")) return s;

  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "(") depth += 1;
    else if (s[i] === ")") {
      depth -= 1;
      if (depth === 0 && i !== s.length - 1) return s;
    }
  }
  if (depth !== 0) {
    throw new Error(`Unbalanced parentheses in logic expression: ${s}`);
  }
  return s.slice(1, -1);
}

interface LogicGroup {
  not: boolean;
  join: "AND" | "OR";
  inner: string;
}

/**
 * Match and=(...), or=(...), not.and=(...), not.or=(...) with balanced parens.
 */
function matchLogicGroup(item: string): LogicGroup | null {
  const s = item.trim();
  const m = s.match(/^(not\.)?(and|or)=\(/i);
  if (!m) return null;

  const openIdx = m[0].length - 1;
  let depth = 0;
  for (let i = openIdx; i < s.length; i++) {
    if (s[i] === "(") depth += 1;
    else if (s[i] === ")") {
      depth -= 1;
      if (depth === 0) {
        if (i !== s.length - 1) {
          throw new Error(`Unexpected trailing characters in logic group: ${s}`);
        }
        const join = m[2].toLowerCase() === "and" ? "AND" : "OR";
        return {
          not: Boolean(m[1]),
          join,
          inner: s.slice(openIdx + 1, i),
        };
      }
    }
  }
  throw new Error(`Unbalanced parentheses in logic group: ${s}`);
}

function parseLogicList(
  body: string,
  join: "AND" | "OR",
  offset: number,
  parseAtom: AtomParser,
  depth: number
): { sql: string; values: unknown[] } {
  if (depth > MAX_LOGIC_DEPTH) {
    throw new Error(
      `Logic nesting too deep (max ${MAX_LOGIC_DEPTH}). Simplify the or/and expression.`
    );
  }

  const items = splitTopLevelCommas(body)
    .map((p) => p.trim())
    .filter(Boolean);
  if (items.length === 0) {
    throw new Error("Empty logic group");
  }

  const parts: string[] = [];
  const values: unknown[] = [];

  for (const item of items) {
    const group = matchLogicGroup(item);
    if (group) {
      const inner = parseLogicList(
        group.inner,
        group.join,
        offset + values.length,
        parseAtom,
        depth + 1
      );
      const clause = `(${inner.sql})`;
      parts.push(group.not ? `NOT ${clause}` : clause);
      values.push(...inner.values);
      continue;
    }

    const atom = parseAtom(item, offset + values.length);
    parts.push(atom.sql);
    values.push(...atom.values);
  }

  return {
    sql: parts.join(` ${join} `),
    values,
  };
}

/**
 * Parse one or=/and=/not.* query value into a parenthesized SQL fragment.
 * Accepts PostgREST `(a,b)` wrapping and legacy bare `a,b` lists.
 */
export function parseLogicParam(
  raw: string,
  defaultJoin: "AND" | "OR",
  offset: number,
  parseAtom: AtomParser,
  options: { not?: boolean } = {}
): { sql: string; values: unknown[] } {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("Empty logic expression");
  }

  // Whole value is a single and=(...)/or=(...)/not.* group
  const asGroup = matchLogicGroup(trimmed);
  if (asGroup) {
    const inner = parseLogicList(
      asGroup.inner,
      asGroup.join,
      offset,
      parseAtom,
      1
    );
    const clause = `(${inner.sql})`;
    const negated = options.not || asGroup.not;
    return {
      sql: negated ? `NOT ${clause}` : clause,
      values: inner.values,
    };
  }

  const body = unwrapOuterParens(trimmed);
  const { sql, values } = parseLogicList(
    body,
    defaultJoin,
    offset,
    parseAtom,
    0
  );
  const clause = `(${sql})`;
  return {
    sql: options.not ? `NOT ${clause}` : clause,
    values,
  };
}

/**
 * True when every item is a flat filter atom (legacy or=a,b split list).
 */
export function isFlatAtomList(items: string[]): boolean {
  return items.every((item) => {
    const s = item.trim();
    if (!s) return false;
    if (s.includes("(")) return false;
    if (/^(not\.)?(and|or)=/i.test(s)) return false;
    return true;
  });
}
