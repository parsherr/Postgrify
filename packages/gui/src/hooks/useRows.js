/**
 * Satır CRUD hook'ları.
 * C-01: list body = array; total from Content-Range when Prefer: count=exact.
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api.js";
import { queryKeys } from "../lib/queryKeys.js";
/** Parse PostgREST Content-Range: start-end/total|* */
export function parseContentRange(header) {
    if (!header)
        return null;
    const m = header.match(/^(\d+)-(\d+)\/(\d+|\*)$/);
    if (!m)
        return null;
    return {
        start: Number(m[1]),
        end: Number(m[2]),
        total: m[3] === "*" ? null : Number(m[3]),
    };
}
export function useRows(db, table, params = {}) {
    return useQuery({
        queryKey: queryKeys.rows(db, table, params),
        queryFn: async () => {
            const qs = new URLSearchParams();
            const limit = params.limit ?? 100;
            const offset = params.offset ?? 0;
            qs.set("limit", String(limit));
            qs.set("offset", String(offset));
            if (params.select)
                qs.set("select", String(params.select));
            if (params.order)
                qs.set("order", String(params.order));
            params.where?.forEach((w) => qs.append("where", w));
            const query = qs.toString();
            const { data, headers } = await api.getWithHeaders(`/db/${db}/${table}${query ? `?${query}` : ""}`, { headers: { Prefer: "count=exact" } });
            const rows = Array.isArray(data) ? data : [];
            const cr = parseContentRange(headers.get("content-range"));
            return {
                rows,
                total: cr?.total ?? rows.length,
                limit,
                offset,
            };
        },
        enabled: !!(db && table),
    });
}
export function useInsertRow() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ db, table, data, }) => api.post(`/db/${db}/${table}`, data, {
            headers: { Prefer: "return=representation" },
        }),
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
