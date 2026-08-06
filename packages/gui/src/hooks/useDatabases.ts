/**
 * Veritabanı yönetim hook'ları.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api.js";
import { queryKeys } from "../lib/queryKeys.js";
import type { Database, AdminStats } from "../types/index.js";

export function useDatabases() {
  return useQuery({
    queryKey: queryKeys.databases(),
    queryFn: () =>
      api
        .get<{ databases: Database[] }>("/admin/databases")
        .then((r) => r.databases),
  });
}

export function useAdminStats() {
  return useQuery({
    queryKey: queryKeys.adminStats(),
    queryFn: () => api.get<AdminStats>("/admin/stats"),
    refetchInterval: 30_000,
  });
}

export function useCreateDatabase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) =>
      api.post<{ name: string; created: boolean }>("/admin/databases", { name }),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.databases() }),
  });
}

export function useDeleteDatabase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => api.delete(`/admin/databases/${name}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.databases() }),
  });
}

