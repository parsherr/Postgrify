/**
 * Per-DB auth session hook'ları.
 * GET/DELETE /db/:database/auth/sessions
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api.js";

export interface DbAuthSession {
  id: string;
  user_id: string;
  user_email: string | null;
  expires_at: string;
  created_at: string;
  revoked: boolean;
  ip: string | null;
  user_agent: string | null;
}

export interface DbAuthSessionsResult {
  data: DbAuthSession[];
  total: number;
}

const key = (db: string) => ["auth-sessions", db] as const;

export function useAuthSessions(db: string) {
  return useQuery({
    queryKey: key(db),
    queryFn: () => api.get<DbAuthSessionsResult>(`/db/${db}/auth/sessions`),
    enabled: !!db,
    staleTime: 15_000,
  });
}

export function useRevokeAuthSession(db: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.delete(`/db/${db}/auth/sessions/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: key(db) }),
  });
}

export function useRevokeAllUserSessions(db: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) =>
      api.delete(`/db/${db}/auth/sessions?user_id=${userId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: key(db) }),
  });
}