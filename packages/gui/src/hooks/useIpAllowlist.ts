/**
 * useIpAllowlist — React Query hooks for per-database IP allowlist management.
 *
 * Hooks:
 *   useIpAllowlist(db)     — reads the current configuration
 *   useSetIpAllowlist(db)  — updates the configuration
 *   useResetIpAllowlist(db)— resets to allow everyone
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import * as api from "../lib/api.js";
import type { IpAllowlistConfig } from "../lib/api.js";

// ── Query key factory ─────────────────────────────────────────────────────────

const ipAllowlistKeys = {
  config: (db: string) => ["ip-allowlist", db] as const,
};

// ── Read hook ─────────────────────────────────────────────────────────────────

/** Returns the IP allowlist configuration for the given database. */
export function useIpAllowlist(db: string) {
  return useQuery({
    queryKey: ipAllowlistKeys.config(db),
    queryFn: () => api.getIpAllowlist(db),
    enabled: Boolean(db),
    staleTime: 30_000,
  });
}

// ── Write hooks ───────────────────────────────────────────────────────────────

/** Updates the IP allowlist configuration. */
export function useSetIpAllowlist(db: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (config: IpAllowlistConfig) => api.setIpAllowlist(db, config),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ipAllowlistKeys.config(db) });
    },
  });
}

/** Resets the IP allowlist to allow everyone. */
export function useResetIpAllowlist(db: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.deleteIpAllowlist(db),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ipAllowlistKeys.config(db) });
    },
  });
}