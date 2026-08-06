/**
 * Per-database auth hook'ları.
 *
 * API: /db/:database/auth/*
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api.js";
import { queryKeys } from "../lib/queryKeys.js";
export function useDbAuthUsers(db) {
    return useQuery({
        queryKey: queryKeys.dbAuthUsers(db),
        queryFn: () => api.get(`/db/${db}/auth/users`),
        enabled: !!db,
    });
}
export function useCreateDbAuthUser(db) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (payload) => api.post(`/db/${db}/auth/users`, payload),
        onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.dbAuthUsers(db) }),
    });
}
export function useUpdateDbAuthUser(db) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ id, ...payload }) => api.patch(`/db/${db}/auth/users/${id}`, payload),
        onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.dbAuthUsers(db) }),
    });
}
export function useDeleteDbAuthUser(db) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (id) => api.delete(`/db/${db}/auth/users/${id}`),
        onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.dbAuthUsers(db) }),
    });
}
export function useResetDbAuthUserPassword(db) {
    return useMutation({
        mutationFn: ({ id, password }) => api.post(`/db/${db}/auth/users/${id}/reset-password`, { password }),
    });
}
