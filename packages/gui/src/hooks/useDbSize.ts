/**
 * Database size and stats hooks.
 */

import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api.js";
import { queryKeys } from "../lib/queryKeys.js";
import type { DbSize } from "../types/index.js";

interface TableStats {
  database: string;
  tables: Array<{
    name: string;
    estimated_row_count: number;
    total_size: string;
    table_size: string;
    index_size: string;
  }>;
}

export function useDbSize(db: string) {
  return useQuery({
    queryKey: queryKeys.dbSize(db),
    queryFn: () => api.get<DbSize>(`/db/${db}/size`),
    enabled: !!db,
    staleTime: 60_000,
  });
}

export function useDbStats(db: string) {
  return useQuery({
    queryKey: queryKeys.dbStats(db),
    queryFn: () => api.get<TableStats>(`/db/${db}/stats`),
    enabled: !!db,
    staleTime: 60_000,
  });
}