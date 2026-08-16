/**
 * useIpAllowlist — Per-database IP erişim listesi yönetimi için React Query hooks.
 *
 * Hooks:
 *   useIpAllowlist(db)     — mevcut konfigürasyonu okur
 *   useSetIpAllowlist(db)  — konfigürasyonu günceller
 *   useResetIpAllowlist(db)— everyone'a sıfırlar
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import * as api from "../lib/api.js";
// ── Query key factory ─────────────────────────────────────────────────────────
const ipAllowlistKeys = {
    config: (db) => ["ip-allowlist", db],
};
// ── Read hook ─────────────────────────────────────────────────────────────────
/** Belirtilen DB'nin IP allowlist konfigürasyonunu döner. */
export function useIpAllowlist(db) {
    return useQuery({
        queryKey: ipAllowlistKeys.config(db),
        queryFn: () => api.getIpAllowlist(db),
        enabled: Boolean(db),
        staleTime: 30000,
    });
}
// ── Write hooks ───────────────────────────────────────────────────────────────
/** IP allowlist konfigürasyonunu günceller. */
export function useSetIpAllowlist(db) {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (config) => api.setIpAllowlist(db, config),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ipAllowlistKeys.config(db) });
        },
    });
}
/** IP allowlist'i everyone'a sıfırlar. */
export function useResetIpAllowlist(db) {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: () => api.deleteIpAllowlist(db),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ipAllowlistKeys.config(db) });
        },
    });
}
