/**
 * Satır CRUD hook'ları.
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api.js";
import { queryKeys } from "../lib/queryKeys.js";
export function useRows(db, table, params = {}) {
    return useQuery({
        queryKey: queryKeys.rows(db, table, params),
        queryFn: () => {
            const qs = new URLSearchParams();
            if (params.limit)
                qs.set("limit", String(params.limit));
            if (params.offset)
                qs.set("offset", String(params.offset));
            if (params.select)
                qs.set("select", String(params.select));
            if (params.order)
                qs.set("order", String(params.order));
            params.where?.forEach((w) => qs.append("where", w));
            const query = qs.toString();
            return api.get(`/db/${db}/${table}${query ? `?${query}` : ""}`);
        },
        enabled: !!(db && table),
    });
}
export function useInsertRow() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ db, table, data, }) => api.post(`/db/${db}/${table}`, data),
        onSuccess: (_data, { db, table }) => qc.invalidateQueries({ queryKey: queryKeys.rows(db, table) }),
    });
}
export function useUpdateRow() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ db, table, id, data, }) => api.put(`/db/${db}/${table}/${id}`, data),
        onSuccess: (_data, { db, table }) => qc.invalidateQueries({ queryKey: queryKeys.rows(db, table) }),
    });
}
export function useDeleteRow() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ db, table, id, }) => api.delete(`/db/${db}/${table}/${id}`),
        onSuccess: (_data, { db, table }) => qc.invalidateQueries({ queryKey: queryKeys.rows(db, table) }),
    });
}
