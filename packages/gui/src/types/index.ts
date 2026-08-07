/**
 * API yanıt tipleri.
 */

export interface Database {
  name: string;
  /** PostgreSQL bigint → string olarak gelebilir, Number() ile parse et */
  size_bytes: number | string;
  /** cross-DB sorgu kısıtı nedeniyle güvenilmez, 0 gelebilir */
  table_count: number;
  }

export interface TableInfo {
  name: string;
  /** pg_class.reltuples: -1 = hiç ANALYZE edilmemiş, 0 = boş, >0 tahmin */
  estimated_row_count: number;
  size: string;
}

export interface Column {
  name: string;
  type: string;
  nullable: string;   // "YES" | "NO"
  default: string | null;
  primary_key: boolean;
}

export interface TableSchema {
  table: string;
  columns: Column[];
}

export interface RowsResult {
  rows: Record<string, unknown>[];
  total: number;
  limit: number;
  offset: number;
}

export interface DbSize {
  size_bytes: number;
  size_human: string;
}

export interface DbStats {
  database: string;
  tables: Array<{
    name: string;
    row_count: number;
    size: string;
    size_bytes: number;
  }>;
}

export interface AdminStats {
  uptime: number;
  activePools: number;
  activePoolNames: string[];
  totalSizeBytes: number;
  nodeVersion: string;
}

export interface TokenResponse {
  token: string;
  role: string;
  database?: string;
  scope?: string[];
  expiresIn: string;
}

// ── Per-database Auth ────────────────────────────────────────────────────────

export type DbAuthUserRole = "viewer" | "editor" | "admin";

export interface DbAuthUser {
  id: string;
  email: string;
  role: DbAuthUserRole;
  is_active: boolean;
  created_at: string;
  last_login: string | null;
  metadata: Record<string, unknown>;
}

export interface DbAuthUsersResult {
  users: DbAuthUser[];
  total: number;
}