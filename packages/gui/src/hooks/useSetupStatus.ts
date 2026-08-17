/**
 * useSetupStatus — wraps GET /setup/status with React Query.
 * Runs at app startup; result is consumed by SetupGuard.
 *
 * Why staleTime: 0?
 *   During `docker compose up` the GUI container may be ready before the API.
 *   If the first request fails (API not yet up), React Query's retry mechanism
 *   kicks in and keeps retrying until the API is available.
 *   With staleTime: Infinity a failed first request would be cached as
 *   "configured: false" and never refetched — the setup page would stay open forever.
 *
 * Why retry: 5 with incremental retryDelay?
 *   The API container is typically ready within 10–30 seconds.
 *   5 retries × (1–5 s) ≈ 15 s window.
 *   If the API is still not up after that, an error is shown to the user.
 */

import { useQuery } from "@tanstack/react-query";
import { getSetupStatus } from "../lib/api";

export function useSetupStatus() {
  return useQuery({
    queryKey: ["setup-status"],
    queryFn: getSetupStatus,
    // staleTime: 0 → ask the API on every mount; setup status can change
    staleTime: 0,
    // gcTime: 0 → remove from cache on unmount; fetch fresh on next mount
    gcTime: 0,
    // Retry 5 times: wait for the API container to become ready
    retry: 5,
    // Incremental backoff: 1 s, 2 s, 4 s, 8 s, 16 s (capped at 16 s)
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 16_000),
  });
}