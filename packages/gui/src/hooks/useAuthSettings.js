/**
 * Per-DB auth settings hook'ları.
 *
 * GET/PUT /db/:database/auth/settings
 * GET/POST/DELETE /db/:database/auth/settings/oauth
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api.js";
const keys = {
    settings: (db) => ["auth-settings", db],
    oauth: (db) => ["auth-oauth", db],
};
export function useAuthSettings(db) {
    return useQuery({
        queryKey: keys.settings(db),
        queryFn: () => api.get(`/db/${db}/auth/settings`),
        enabled: !!db,
    });
}
export function useUpdateAuthSettings(db) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (settings) => api.put(`/db/${db}/auth/settings`, settings),
        onSuccess: () => qc.invalidateQueries({ queryKey: keys.settings(db) }),
    });
}
export function useOAuthProviders(db) {
    return useQuery({
        queryKey: keys.oauth(db),
        queryFn: () => api.get(`/db/${db}/auth/settings/oauth`),
        enabled: !!db,
    });
}
export function useUpsertOAuthProvider(db) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (payload) => api.post(`/db/${db}/auth/settings/oauth`, payload),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: keys.oauth(db) });
            qc.invalidateQueries({ queryKey: keys.settings(db) });
        },
    });
}
export function useDeleteOAuthProvider(db) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (provider) => api.delete(`/db/${db}/auth/settings/oauth/${provider}`),
        onSuccess: () => qc.invalidateQueries({ queryKey: keys.oauth(db) }),
    });
}
