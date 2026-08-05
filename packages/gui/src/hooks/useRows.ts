/**
 * Satır CRUD hook'ları.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api.js";
import { queryKeys } from "../lib/queryKeys.js";
import type { RowsResult } from "../types/index.js";

interface RowsParams {
  limit?: number;
  offset?: number;
  select?: string;
  order?: string;
  where?: string[];
  [key: string]: unknown;  // index signature for queryKey compatibility
}

export function useRows(db: string, table: string, params: RowsParams = {}) {
  return useQuery({
    queryKey: queryKeys.rows(db, table, params),
    queryFn: () => {
      const qs = new URLSearchParams();
      if (params.limit) qs.set("limit", String(params.limit));
      if (params.offset) qs.set("offset", String(params.offset));
      if (params.select) qs.set("select", String(params.select));
      if (params.order) qs.set("order", String(params.order));
      (params.where as string[] | undefined)?.forEach((w) => qs.append("where", w));
      const query = qs.toString();
      return api.get<RowsResult>(`/db/${db}/${table}${query ? `?${query}` : ""}`);
    },
    enabled: !!(db && table),
  });
}

export function useInsertRow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      db,
      table,
      data,
    }: {
      db: string;
      table: string;
      data: Record<string, unknown>;
    }) => api.post<Record<string, unknown>>(`/db/${db}/${table}`, data),
    onSuccess: (_data, { db, table }) =>
      qc.invalidateQueries({ queryKey: queryKeys.rows(db, table) }),
  });
}

export function useUpdateRow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      db,
      table,
      id,
      data,
    }: {
      db: string;
      table: string;
      id: string | number;
      data: Record<string, unknown>;
    }) => api.put<Record<string, unknown>>(`/db/${db}/${table}/${id}`, data),
    onSuccess: (_data, { db, table }) =>
      qc.invalidateQueries({ queryKey: queryKeys.rows(db, table) }),
  });
}

export function useDeleteRow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      db,
      table,
      id,
    }: {
      db: string;
      table: string;
      id: string | number;
    }) => api.delete(`/db/${db}/${table}/${id}`),
    onSuccess: (_data, { db, table }) =>
      qc.invalidateQueries({ queryKey: queryKeys.rows(db, table) }),
  });
}