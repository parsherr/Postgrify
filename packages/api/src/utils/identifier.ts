/**
 * PostgreSQL identifier (tablo adı, kolon adı, DB adı) doğrulama yardımcıları.
 *
 * Kural: /^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/
 *   - Harf veya alt çizgi ile başlamalı
 *   - Harf, rakam veya alt çizgi içerebilir
 *   - Maksimum 63 karakter (PG limiti)
 *
 * Ayrıca SQL reserved keyword'ler ve sistem şema prefix'leri reddedilir.
 */

const IDENTIFIER_REGEX = /^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/;

// Tam eşleşme ile reddedilen reserved keyword'ler
const RESERVED_WORDS = new Set([
  "select", "insert", "update", "delete", "drop", "create", "alter",
  "truncate", "grant", "revoke", "commit", "rollback", "begin",
  "information_schema",
]);

// Bu prefix'lerle başlayan identifier'lar sistem nesnelerine referans verebilir.
// Örn: pg_stat_activity, pg_class, pg_catalog — RESERVED_WORDS Set'ine tam
// isim eklenseydi pg_stat_activity geçerdi; prefix kontrolü bunu önler.
const RESERVED_PREFIXES = ["pg_", "_postgrify_"];

export function isValidIdentifier(name: string): boolean {
  if (!IDENTIFIER_REGEX.test(name)) return false;
  const lower = name.toLowerCase();
  if (RESERVED_WORDS.has(lower)) return false;
  // Sistem prefix kontrolü — tam Set eşleşmesi prefix'leri yakalayamaz
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