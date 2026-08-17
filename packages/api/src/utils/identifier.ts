/**
 * PostgreSQL identifier (table name, column name, DB name) validation helpers.
 *
 * Kural: /^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/
 *   - Must start with a letter or underscore
 *   - May contain letters, digits, or underscores
 *   - Maksimum 63 karakter (PG limiti)
 *
 * SQL reserved keywords and system schema prefixes are also rejected.
 */

const IDENTIFIER_REGEX = /^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/;

// Reserved keywords rejected by exact match
const RESERVED_WORDS = new Set([
  "select", "insert", "update", "delete", "drop", "create", "alter",
  "truncate", "grant", "revoke", "commit", "rollback", "begin",
  "information_schema",
]);

// Identifiers starting with these prefixes may reference system objects.
// e.g. pg_stat_activity, pg_class, pg_catalog — adding the full name to RESERVED_WORDS
// would have allowed pg_stat_activity; the prefix check prevents this.
const RESERVED_PREFIXES = ["pg_", "_postgrify_"];

export function isValidIdentifier(name: string): boolean {
  if (!IDENTIFIER_REGEX.test(name)) return false;
  const lower = name.toLowerCase();
  if (RESERVED_WORDS.has(lower)) return false;
  // System prefix check — an exact Set match cannot catch prefixes
  for (const prefix of RESERVED_PREFIXES) {
    if (lower.startsWith(prefix)) return false;
  }
  return true;
}

export function assertIdentifier(name: string, label: string): void {
  if (!isValidIdentifier(name)) {
    throw new Error(
      `Invalid ${label} name: '${name}'. Must match /^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/ and not be a reserved word.`
    );
  }
}