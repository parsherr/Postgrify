/**
 * Per-database auth hooks.
 *
 * API: /db/:database/auth/*
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api.js";
import { queryKeys } from "../lib/queryKeys.js";
import type { DbAuthUser, DbAuthUserRole, DbAuthUsersResult } from "../types/index.js";

export function useDbAuthUsers(db: string) {
  return useQuery({
    queryKey: queryKeys.dbAuthUsers(db),
    queryFn: () =>
      api.get<DbAuthUsersResult>(`/db/${db}/auth/users`),
    enabled: !!db,
  });
}

export function useCreateDbAuthUser(db: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { email: string; password: string; role: DbAuthUserRole }) =>
      api.post<DbAuthUser>(`/db/${db}/auth/users`, payload),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: queryKeys.dbAuthUsers(db) }),
  });
}

export function useUpdateDbAuthUser(db: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...payload
    }: {
      id: string;
      email?: string;
      role?: DbAuthUserRole;
      is_active?: boolean;
    }) => api.patch<DbAuthUser>(`/db/${db}/auth/users/${id}`, payload),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: queryKeys.dbAuthUsers(db) }),
  });
}

export function useDeleteDbAuthUser(db: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/db/${db}/auth/users/${id}`),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: queryKeys.dbAuthUsers(db) }),
  });
}

export function useResetDbAuthUserPassword(db: string) {
  return useMutation({
    mutationFn: ({ id, password }: { id: string; password: string }) =>
      api.post<{ ok: boolean; message: string }>(
        `/db/${db}/auth/users/${id}/reset-password`,
        { password }
      ),
  });
}