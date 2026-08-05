/**
 * API yanıt tipleri.
 */

export interface Database {
  name: string;
  /** PostgreSQL bigint → string olarak gelebilir, Number() ile parse et */
  size_bytes: number | string;
  /** cross-DB sorgu kısıtı nedeniyle güvenilmez, 0 gelebilir */
  table_count: number;
  /** Pool aktif mi? false = bağlantı kapalı, sorgu yapılamaz */
  pool_active: boolean;
  /** Pool açılma zamanı (ms timestamp). null = kapalı */
  pool_started_at: number | null;
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