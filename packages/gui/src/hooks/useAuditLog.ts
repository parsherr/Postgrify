/**
 * Audit log hooks.
 * GET /db/:database/auth/audit
 */

import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api.js";

export interface AuditLogEntry {
  id: string;
  user_id: string | null;
  user_email: string | null;
  event: string;
  ip: string | null;
  user_agent: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface AuditLogResult {
  data: AuditLogEntry[];
  total: number;
  limit: number;
  offset: number;
}

export function useAuditLog(
  db: string,
  opts: { limit?: number; offset?: number; event?: string; user_id?: string } = {}
) {
  const params = new URLSearchParams();
  if (opts.limit)   params.set("limit",   String(opts.limit));
  if (opts.offset)  params.set("offset",  String(opts.offset));
  if (opts.event)   params.set("event",   opts.event);
  if (opts.user_id) params.set("user_id", opts.user_id);

  const qs = params.toString() ? `?${params}` : "";

  return useQuery({
    queryKey: ["audit-log", db, opts],
    queryFn: () => api.get<AuditLogResult>(`/db/${db}/auth/audit${qs}`),
    enabled: !!db,
    staleTime: 30_000,
  });
}