/**
 * Veritabanı yönetim hook'ları.
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api.js";
import { queryKeys } from "../lib/queryKeys.js";
export function useDatabases() {
    return useQuery({
        queryKey: queryKeys.databases(),
        queryFn: () => api
            .get("/admin/databases")
            .then((r) => r.databases),
    });
}
export function useAdminStats() {
    return useQuery({
        queryKey: queryKeys.adminStats(),
        queryFn: () => api.get("/admin/stats"),
        refetchInterval: 30000,
    });
}
export function useCreateDatabase() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (name) => api.post("/admin/databases", { name }),
        onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.databases() }),
    });
}
export function useDeleteDatabase() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (name) => api.delete(`/admin/databases/${name}`),
        onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.databases() }),
    });
}
