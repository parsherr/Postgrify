/**
 * useSetupStatus — GET /setup/status sorgusunu React Query ile sarar.
 * App başlangıcında çalışır; sonucu SetupGuard tüketir.
 *
 * Neden staleTime: 0?
 *   docker compose up sırasında GUI container API'den önce hazır olabilir.
 *   İlk istek başarısız olursa (API henüz ayakta değil) React Query retry
 *   mekanizması devreye girerek API hazır olana kadar yeniden dener.
 *   staleTime: Infinity olsaydı başarısız ilk istek "configured: false" olarak
 *   önbelleğe alınır ve hiç refetch yapılmazdı — setup sayfası sonsuz açık kalırdı.
 *
 * Neden retry: 5, retryDelay artımlı?
 *   API container 10-30 saniye içinde hazır olur. 5 retry × (1-5s) = ~15s pencere.
 *   Bu sürede API hazır olmazsa kullanıcıya hata gösterilir.
 */
import { useQuery } from "@tanstack/react-query";
import { getSetupStatus } from "../lib/api";
export function useSetupStatus() {
    return useQuery({
        queryKey: ["setup-status"],
        queryFn: getSetupStatus,
        // staleTime: 0 → her mount'ta API'ye sor; setup durumu değişebilir
        staleTime: 0,
        // gcTime: 0 → unmount'ta cache'den sil; bir sonraki mount'ta taze veri gelsin
        gcTime: 0,
        // 5 kez yeniden dene: API container hazırlanana kadar bekle
        retry: 5,
        // Artımlı bekleme: 1s, 2s, 4s, 8s, 16s (max 16s'ye kilitler)
        retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 16000),
    });
}
