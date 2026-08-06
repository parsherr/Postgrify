/**
 * TanStack Query anahtar fabrikası — cache geçersizleştirme için merkezi kaynak.
 */
export const queryKeys = {
    // Admin
    databases: () => ["databases"],
    adminStats: () => ["adminStats"],
    // DB-level
    tables: (db) => ["tables", db],
    tableSchema: (db, table) => ["tableSchema", db, table],
    dbSize: (db) => ["dbSize", db],
    dbStats: (db) => ["dbStats", db],
    // Row-level
    rows: (db, table, params) => params ? ["rows", db, table, params] : ["rows", db, table],
    row: (db, table, id) => ["row", db, table, id],
    // Per-database auth
    dbAuthUsers: (db) => ["dbAuthUsers", db],
};
