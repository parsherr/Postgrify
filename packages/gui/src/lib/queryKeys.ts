/**
 * TanStack Query anahtar fabrikası — cache geçersizleştirme için merkezi kaynak.
 */

export const queryKeys = {
  // Admin
  databases: () => ["databases"] as const,
  adminStats: () => ["adminStats"] as const,

  // DB-level
  tables: (db: string) => ["tables", db] as const,
  tableSchema: (db: string, table: string) => ["tableSchema", db, table] as const,
  dbSize: (db: string) => ["dbSize", db] as const,
  dbStats: (db: string) => ["dbStats", db] as const,

  // Row-level
  rows: (db: string, table: string, params?: Record<string, unknown>) =>
    params ? ["rows", db, table, params] : ["rows", db, table],
  row: (db: string, table: string, id: string | number) =>
    ["row", db, table, id] as const,

  // Per-database auth
  dbAuthUsers: (db: string) => ["dbAuthUsers", db] as const,
} as const;