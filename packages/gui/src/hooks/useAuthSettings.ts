/**
 * Per-DB auth settings hooks.
 *
 * GET/PUT /db/:database/auth/settings
 * GET/POST/DELETE /db/:database/auth/settings/oauth
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api.js";

export interface AuthSettings {
  email_signup_enabled: string;
  magic_link_enabled: string;
  email_verify_required: string;
  oauth_enabled: string;
  signup_redirect_url: string;
  token_expiry: string;
  refresh_token_expiry: string;
}

export interface OAuthProvider {
  id: string;
  provider: "google" | "github";
  client_id: string;
  redirect_uri: string;
  enabled: boolean;
  created_at: string;
}

const keys = {
  settings: (db: string) => ["auth-settings", db] as const,
  oauth: (db: string) => ["auth-oauth", db] as const,
};

export function useAuthSettings(db: string) {
  return useQuery({
    queryKey: keys.settings(db),
    queryFn: () => api.get<AuthSettings>(`/db/${db}/auth/settings`),
    enabled: !!db,
  });
}

export function useUpdateAuthSettings(db: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (settings: Partial<AuthSettings>) =>
      api.put<AuthSettings>(`/db/${db}/auth/settings`, settings),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.settings(db) }),
  });
}

export function useOAuthProviders(db: string) {
  return useQuery({
    queryKey: keys.oauth(db),
    queryFn: () => api.get<OAuthProvider[]>(`/db/${db}/auth/settings/oauth`),
    enabled: !!db,
  });
}

export function useUpsertOAuthProvider(db: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: {
      provider: "google" | "github";
      client_id: string;
      client_secret: string;
      redirect_uri: string;
      enabled?: boolean;
    }) => api.post<OAuthProvider>(`/db/${db}/auth/settings/oauth`, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.oauth(db) });
      qc.invalidateQueries({ queryKey: keys.settings(db) });
    },
  });
}

export function useDeleteOAuthProvider(db: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (provider: string) =>
      api.delete(`/db/${db}/auth/settings/oauth/${provider}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.oauth(db) }),
  });
}