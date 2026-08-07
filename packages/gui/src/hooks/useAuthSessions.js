/**
 * Per-DB auth session hook'ları.
 * GET/DELETE /db/:database/auth/sessions
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api.js";
const key = (db) => ["auth-sessions", db];
export function useAuthSessions(db) {
    return useQuery({
        queryKey: key(db),
        queryFn: () => api.get(`/db/${db}/auth/sessions`),
        enabled: !!db,
        staleTime: 15000,
    });
}
export function useRevokeAuthSession(db) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (id) => api.delete(`/db/${db}/auth/sessions/${id}`),
        onSuccess: () => qc.invalidateQueries({ queryKey: key(db) }),
    });
}
export function useRevokeAllUserSessions(db) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (userId) => api.delete(`/db/${db}/auth/sessions?user_id=${userId}`),
        onSuccess: () => qc.invalidateQueries({ queryKey: key(db) }),
    });
}
