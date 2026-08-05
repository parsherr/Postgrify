/**
 * PostgreSQL identifier (tablo adı, kolon adı, DB adı) doğrulama yardımcıları.
 *
 * Kural: /^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/
 *   - Harf veya alt çizgi ile başlamalı
 *   - Harf, rakam veya alt çizgi içerebilir
 *   - Maksimum 63 karakter (PG limiti)
 *
 * Ayrıca SQL reserved keyword'ler reddedilir.
 */

const IDENTIFIER_REGEX = /^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/;

// Tehlikeli veya kötüye kullanılabilecek reserved keyword'ler
const RESERVED_WORDS = new Set([
  "select", "insert", "update", "delete", "drop", "create", "alter",
  "truncate", "grant", "revoke", "commit", "rollback", "begin",
  "pg_", "information_schema",
]);

export function isValidIdentifier(name: string): boolean {
  if (!IDENTIFIER_REGEX.test(name)) return false;
  if (RESERVED_WORDS.has(name.toLowerCase())) return false;
  return true;
}

export function assertIdentifier(name: string, label: string): void {
  if (!isValidIdentifier(name)) {
    throw new Error(
      `Invalid ${label} name: '${name}'. Must match /^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/ and not be a reserved word.`
    );
  }
}