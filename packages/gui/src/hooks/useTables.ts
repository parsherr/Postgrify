/**
 * Tablo yönetim hook'ları.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api.js";
import { queryKeys } from "../lib/queryKeys.js";
import type { TableInfo, TableSchema } from "../types/index.js";

export function useTables(db: string) {
  return useQuery({
    queryKey: queryKeys.tables(db),
    queryFn: () =>
      api
        .get<{ tables: TableInfo[] }>(`/db/${db}/tables`)
        .then((r) => r.tables),
    enabled: !!db,
  });
}

export function useTableSchema(db: string, table: string) {
  return useQuery({
    queryKey: queryKeys.tableSchema(db, table),
    queryFn: () =>
      api.get<TableSchema>(`/db/${db}/tables/${table}/schema`),
    enabled: !!(db && table),
  });
}

interface CreateTableInput {
  db: string;
  name: string;
  columns: Array<{
    name: string;
    type: string;
    nullable?: boolean;
    primaryKey?: boolean;
    unique?: boolean;
    default?: string;
  }>;
}

export function useCreateTable() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ db, name, columns }: CreateTableInput) =>
      api.post<{ name: string; created: boolean }>(`/db/${db}/tables`, {
        name,
        columns,
      }),
    onSuccess: (_data, { db }) =>
      qc.invalidateQueries({ queryKey: queryKeys.tables(db) }),
  });
}

export function useDropTable() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ db, table }: { db: string; table: string }) =>
      api.delete(`/db/${db}/tables/${table}`),
    onSuccess: (_data, { db }) =>
      qc.invalidateQueries({ queryKey: queryKeys.tables(db) }),
  });
}