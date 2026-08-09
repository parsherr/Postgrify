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
import type { IpAllowlistConfig } from "../lib/api.js";

// ── Query key factory ─────────────────────────────────────────────────────────

const ipAllowlistKeys = {
  config: (db: string) => ["ip-allowlist", db] as const,
};

// ── Read hook ─────────────────────────────────────────────────────────────────

/** Belirtilen DB'nin IP allowlist konfigürasyonunu döner. */
export function useIpAllowlist(db: string) {
  return useQuery({
    queryKey: ipAllowlistKeys.config(db),
    queryFn: () => api.getIpAllowlist(db),
    enabled: Boolean(db),
    staleTime: 30_000,
  });
}

// ── Write hooks ───────────────────────────────────────────────────────────────

/** IP allowlist konfigürasyonunu günceller. */
export function useSetIpAllowlist(db: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (config: IpAllowlistConfig) => api.setIpAllowlist(db, config),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ipAllowlistKeys.config(db) });
    },
  });
}

/** IP allowlist'i everyone'a sıfırlar. */
export function useResetIpAllowlist(db: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.deleteIpAllowlist(db),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ipAllowlistKeys.config(db) });
    },
  });
}