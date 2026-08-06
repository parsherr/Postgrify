/**
 * useSetupStatus — GET /setup/status sorgusunu React Query ile sarar.
 * App başlangıcında bir kez çağrılır; sonucu SetupGuard tüketir.
 */
import { useQuery } from "@tanstack/react-query";
import { getSetupStatus } from "../lib/api";
export function useSetupStatus() {
    return useQuery({
        queryKey: ["setup-status"],
        queryFn: getSetupStatus,
        staleTime: Infinity, // Sayfa yenilenene kadar tekrar sorgulanmaz
        retry: 2,
    });
}
