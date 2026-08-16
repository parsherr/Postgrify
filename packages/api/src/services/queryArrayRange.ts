/**
 * E-12 — PostgREST-style array / range filter value parsers.
 *
 * Array ops use `{a,b,c}` → bound JS array (postgres.js serializes safely).
 * Range ops use `[lo,hi]` / `(lo,hi)` → bound text + allowlisted range cast.
 *
 * No user text is concatenated into SQL operator positions beyond validated
 * range-cast type names from a fixed allowlist.
 */

/** SQL operators for E-12 (PostgREST names → PostgreSQL). */
export const ARRAY_RANGE_OPS: Record<string, string> = {
  cs: "@>",
  cd: "<@",
  ov: "&&",
  sl: "<<",
  sr: ">>",
  nxl: "&>",
  nxr: "&<",
  adj: "-|-",
};

const ARRAY_OPS = new Set(["cs", "cd", "ov"]);
const RANGE_ONLY_OPS = new Set(["sl", "sr", "nxl", "nxr", "adj"]);

const RANGE_CASTS = new Set(["numrange", "daterange", "tsrange"]);

/**
 * Parse `{a,b,"c,d"}` into a JS array for parameterized binding.
 * Unquoted elements reject `;`, `--`, quotes, braces, parens.
 */
export function parseBraceArray(value: string): unknown[] {
  if (!value.startsWith("{") || !value.endsWith("}")) {
    throw new Error(`Array operator expects {a,b,c}, got: ${value}`);
  }

  const inner = value.slice(1, -1);
  if (inner.length === 0) return [];

  const elements: string[] = [];
  let i = 0;
  while (i < inner.length) {
    // skip whitespace between elements
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
        throw new Error("Unterminated quoted array element");
      }
      i++;
      elements.push(buf);
    } else {
      const start = i;
      while (i < inner.length && inner[i] !== ",") i++;
      const raw = inner.slice(start, i).trim();
      if (raw === "") {
        throw new Error("Empty array element");
      }
      if (/[{}\[\]();"'`]|--|\/\*|\0/.test(raw)) {
        throw new Error(`Invalid array element: ${raw}`);
      }
      elements.push(raw);
    }

    while (i < inner.length && /\s/.test(inner[i])) i++;
    if (i < inner.length) {
      if (inner[i] !== ",") {
        throw new Error(`Invalid array literal near: ${inner.slice(i)}`);
      }
      i++;
    }
  }

  if (elements.every((e) => /^-?\d+$/.test(e))) {
    return elements.map((e) => Number.parseInt(e, 10));
  }
  if (elements.every((e) => /^-?\d+\.\d+$/.test(e))) {
    return elements.map((e) => Number.parseFloat(e));
  }
  return elements;
}

export type RangeCast = "numrange" | "daterange" | "tsrange";

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/;
const NUMERIC = /^-?\d+(\.\d+)?$/;
const INF = /^-?infinity$/i;

/**
 * Validate PostgREST-style range literal and pick a safe cast type.
 */
export function parseRangeLiteral(value: string): {
  literal: string;
  cast: RangeCast;
} {
  if (value.length < 5) {
    throw new Error(`Range operator expects [lo,hi] or (lo,hi), got: ${value}`);
  }
  const open = value[0];
  const close = value[value.length - 1];
  if (
    (open !== "[" && open !== "(") ||
    (close !== "]" && close !== ")")
  ) {
    throw new Error(`Range operator expects [lo,hi] or (lo,hi), got: ${value}`);
  }
  if (/[;]|--|\/\*|\0/.test(value)) {
    throw new Error("Invalid characters in range literal");
  }

  const inner = value.slice(1, -1);
  const comma = inner.indexOf(",");
  if (comma === -1 || comma !== inner.lastIndexOf(",")) {
    throw new Error(`Range literal must have exactly one comma: ${value}`);
  }
  const lo = inner.slice(0, comma).trim();
  const hi = inner.slice(comma + 1).trim();
  if (!lo || !hi) {
    throw new Error(`Empty range bound in: ${value}`);
  }

  const loOk = NUMERIC.test(lo) || INF.test(lo) || DATE_ONLY.test(lo) || TIMESTAMP.test(lo);
  const hiOk = NUMERIC.test(hi) || INF.test(hi) || DATE_ONLY.test(hi) || TIMESTAMP.test(hi);
  if (!loOk || !hiOk) {
    throw new Error(`Invalid range bounds in: ${value}`);
  }

  let cast: RangeCast = "numrange";
  if (
    (DATE_ONLY.test(lo) || TIMESTAMP.test(lo) || INF.test(lo)) &&
    (DATE_ONLY.test(hi) || TIMESTAMP.test(hi) || INF.test(hi))
  ) {
    if (TIMESTAMP.test(lo) || TIMESTAMP.test(hi)) cast = "tsrange";
    else if (DATE_ONLY.test(lo) || DATE_ONLY.test(hi)) cast = "daterange";
    else cast = "numrange"; // both infinity — numrange is fine
  } else if (
    !(NUMERIC.test(lo) || INF.test(lo)) ||
    !(NUMERIC.test(hi) || INF.test(hi))
  ) {
    throw new Error(`Mixed or invalid range bound types in: ${value}`);
  }

  if (!RANGE_CASTS.has(cast)) {
    throw new Error(`Invalid range cast: ${cast}`);
  }

  return { literal: value, cast };
}

/**
 * Build SQL fragment + bind values for an E-12 operator.
 */
export function buildArrayRangeClause(
  columnSql: string,
  op: string,
  value: string,
  paramOffset: number
): { sql: string; values: unknown[] } {
  const sqlOp = ARRAY_RANGE_OPS[op];
  if (!sqlOp) {
    throw new Error(`Unknown array/range operator: ${op}`);
  }

  const placeholder = `$${paramOffset + 1}`;

  if (ARRAY_OPS.has(op)) {
    if (value.startsWith("{")) {
      const arr = parseBraceArray(value);
      return {
        sql: `${columnSql} ${sqlOp} ${placeholder}`,
        values: [arr],
      };
    }
    if (value.startsWith("[") || value.startsWith("(")) {
      // cs/cd/ov also apply to range types
      const range = parseRangeLiteral(value);
      return {
        sql: `${columnSql} ${sqlOp} ${placeholder}::${range.cast}`,
        values: [range.literal],
      };
    }
    throw new Error(
      `Operator "${op}" expects {a,b} array or [lo,hi] range, got: ${value}`
    );
  }

  if (RANGE_ONLY_OPS.has(op)) {
    const range = parseRangeLiteral(value);
    return {
      sql: `${columnSql} ${sqlOp} ${placeholder}::${range.cast}`,
      values: [range.literal],
    };
  }

  throw new Error(`Unknown array/range operator: ${op}`);
}

export function isArrayRangeOp(op: string): boolean {
  return Object.prototype.hasOwnProperty.call(ARRAY_RANGE_OPS, op);
}
