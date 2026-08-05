/**
 * Tablo yönetim hook'ları.
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api.js";
import { queryKeys } from "../lib/queryKeys.js";
export function useTables(db) {
    return useQuery({
        queryKey: queryKeys.tables(db),
        queryFn: () => api
            .get(`/db/${db}/tables`)
            .then((r) => r.tables),
        enabled: !!db,
    });
}
export function useTableSchema(db, table) {
    return useQuery({
        queryKey: queryKeys.tableSchema(db, table),
        queryFn: () => api.get(`/db/${db}/tables/${table}/schema`),
        enabled: !!(db && table),
    });
}
export function useCreateTable() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ db, name, columns }) => api.post(`/db/${db}/tables`, {
            name,
            columns,
        }),
        onSuccess: (_data, { db }) => qc.invalidateQueries({ queryKey: queryKeys.tables(db) }),
    });
}
export function useDropTable() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ db, table }) => api.delete(`/db/${db}/tables/${table}`),
        onSuccess: (_data, { db }) => qc.invalidateQueries({ queryKey: queryKeys.tables(db) }),
    });
}
