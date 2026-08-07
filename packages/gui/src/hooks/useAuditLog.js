/**
 * Audit log hook'ları.
 * GET /db/:database/auth/audit
 */
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api.js";
export function useAuditLog(db, opts = {}) {
    const params = new URLSearchParams();
    if (opts.limit)
        params.set("limit", String(opts.limit));
    if (opts.offset)
        params.set("offset", String(opts.offset));
    if (opts.event)
        params.set("event", opts.event);
    if (opts.user_id)
        params.set("user_id", opts.user_id);
    const qs = params.toString() ? `?${params}` : "";
    return useQuery({
        queryKey: ["audit-log", db, opts],
        queryFn: () => api.get(`/db/${db}/auth/audit${qs}`),
        enabled: !!db,
        staleTime: 30000,
    });
}
