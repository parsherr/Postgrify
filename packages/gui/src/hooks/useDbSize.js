/**
 * DB boyut ve istatistik hook'ları.
 */
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api.js";
import { queryKeys } from "../lib/queryKeys.js";
export function useDbSize(db) {
    return useQuery({
        queryKey: queryKeys.dbSize(db),
        queryFn: () => api.get(`/db/${db}/size`),
        enabled: !!db,
        staleTime: 60000,
    });
}
export function useDbStats(db) {
    return useQuery({
        queryKey: queryKeys.dbStats(db),
        queryFn: () => api.get(`/db/${db}/stats`),
        enabled: !!db,
        staleTime: 60000,
    });
}
