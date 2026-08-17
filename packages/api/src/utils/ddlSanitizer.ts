/**
 * DDL security helpers — validates col.type and col.default values for CREATE TABLE.
 * Prevents direct string interpolation.
 */

// Desteklenen PostgreSQL kolon tipleri (allowlist)
const ALLOWED_TYPES = new Set([
  "TEXT",
  "VARCHAR",
  "CHAR",
  "CHARACTER VARYING",
  "INTEGER",
  "INT",
  "INT2",
  "INT4",
  "INT8",
  "BIGINT",
  "SMALLINT",
  "SERIAL",
  "BIGSERIAL",
  "SMALLSERIAL",
  "BOOLEAN",
  "BOOL",
  "NUMERIC",
  "DECIMAL",
  "REAL",
  "FLOAT",
  "FLOAT4",
  "FLOAT8",
  "DOUBLE PRECISION",
  "JSONB",
  "JSON",
  "UUID",
  "TIMESTAMP",
  "TIMESTAMPTZ",
  "TIMESTAMP WITH TIME ZONE",
  "TIMESTAMP WITHOUT TIME ZONE",
  "DATE",
  "TIME",
  "TIMETZ",
  "BYTEA",
  "INET",
  "CIDR",
  "MACADDR",
  "OID",
]);

// VARCHAR(n), NUMERIC(p,s) gibi parantezli tipleri normalize eder: "VARCHAR(255)" → "VARCHAR"
function normalizeType(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s*\(.*\)$/, "");
}

/**
 * Validates a column type. Throws if invalid.
 * "VARCHAR(255)" → valid (base type VARCHAR is in the allowlist).
 */
export function assertColumnType(type: string, columnName: string): string {
  const normalized = normalizeType(type);
  if (!ALLOWED_TYPES.has(normalized)) {
    throw new Error(
      `Invalid column type '${type}' for column '${columnName}'. ` +
        `Allowed types: ${[...ALLOWED_TYPES].join(", ")}`
    );
  }
  // Return the original form (uppercased normalized)
  return type.trim().toUpperCase();
}

/**
 * Safe DEFAULT values:
 *   - SQL fonksiyonu: now(), gen_random_uuid(), current_timestamp, vb.
 *   - Numeric literal: 0, 42, -1, 3.14
 *   - Boolean literal: true, false
 *   - NULL
 *   - Single-quoted string: 'active', 'pending'
 *     (no unescaped single quotes inside; escaped with '')
 */
const SAFE_FUNCTION_DEFAULTS = new Set([
  "NOW()",
  "CURRENT_TIMESTAMP",
  "CURRENT_DATE",
  "CURRENT_TIME",
  "GEN_RANDOM_UUID()",
  "UUID_GENERATE_V4()",
  "TRUE",
  "FALSE",
  "NULL",
]);

const NUMERIC_LITERAL = /^-?\d+(\.\d+)?$/;
// Single-quoted string: starts and ends with a single quote, no unescaped single quotes inside
// Single-quoted string literal — safe characters + escaped quote ('')
// SQL special characters such as semicolons, parentheses, double dashes (--) are rejected
const QUOTED_STRING_LITERAL = /^'([a-zA-Z0-9 ğüşıöçĞÜŞİÖÇ_\-.@+%]|'')*'$/;

/**
 * Validates a DEFAULT value and returns it as a safe SQL fragment.
 * Throws if invalid.
 */
export function assertColumnDefault(
  defaultValue: string,
  columnName: string
): string {
  const upper = defaultValue.trim().toUpperCase();

  if (SAFE_FUNCTION_DEFAULTS.has(upper)) {
    return upper;
  }

  if (NUMERIC_LITERAL.test(defaultValue.trim())) {
    return defaultValue.trim();
  }

  if (QUOTED_STRING_LITERAL.test(defaultValue.trim())) {
    return defaultValue.trim();
  }

  throw new Error(
    `Invalid DEFAULT value '${defaultValue}' for column '${columnName}'. ` +
      `Allowed: SQL functions (now(), gen_random_uuid(), ...), ` +
      `numeric literals, boolean literals, NULL, or single-quoted strings like 'active'.`
  );
}