/**
 * DDL güvenlik yardımcıları — CREATE TABLE için col.type ve col.default değerlerini
 * doğrular. Doğrudan string interpolasyonunu önler.
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
 * Kolon tipini doğrular. Geçersizse hata fırlatır.
 * "VARCHAR(255)" → geçerli (base type VARCHAR allowlist'te).
 */
export function assertColumnType(type: string, columnName: string): string {
  const normalized = normalizeType(type);
  if (!ALLOWED_TYPES.has(normalized)) {
    throw new Error(
      `Invalid column type '${type}' for column '${columnName}'. ` +
        `Allowed types: ${[...ALLOWED_TYPES].join(", ")}`
    );
  }
  // Orijinal formu (büyük harf normalleştirilmiş) döndür
  return type.trim().toUpperCase();
}

/**
 * Güvenli DEFAULT değerleri:
 *   - SQL fonksiyonu: now(), gen_random_uuid(), current_timestamp, vb.
 *   - Sayısal literal: 0, 42, -1, 3.14
 *   - Boolean literal: true, false
 *   - NULL
 *   - Tek tırnaklı string: 'active', 'pending'
 *     (içinde tek tırnak yoksa; varsa çift tırnak kaçışı: '' ile)
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
// Tek tırnaklı string: başı ve sonu tek tırnak, içinde '' kaçışı dışında tek tırnak yok
// Tek tırnaklı string literal — güvenli karakterler + escaped quote ('')
// Noktalı virgül, parantez, tire tire (--) gibi SQL özel karakterleri reddedilir
const QUOTED_STRING_LITERAL = /^'([a-zA-Z0-9 ğüşıöçĞÜŞİÖÇ_\-.@+%]|'')*'$/;

/**
 * DEFAULT değerini doğrular ve güvenli SQL fragmanı olarak döndürür.
 * Geçersizse hata fırlatır.
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