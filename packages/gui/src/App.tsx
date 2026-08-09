/**
 * Uygulama kökü — routing ve layout.
 */

import { useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "./contexts/AuthContext";
import { useAuthContext } from "./hooks/useAuthContext";
import { useSetupStatus } from "./hooks/useSetupStatus";
import { setTokenAccessors } from "./lib/api";
import { AppShell } from "./components/layout/AppShell";
import LoginPage from "./pages/LoginPage";
import SetupPage from "./pages/SetupPage";
import DashboardPage from "./pages/DashboardPage";
import DatabasesPage from "./pages/DatabasesPage";
import DatabasePage from "./pages/DatabasePage";
import TablePage from "./pages/TablePage";
import CreateTablePage from "./pages/CreateTablePage";
import QueryPage from "./pages/QueryPage";
import ApiKeysPage from "./pages/ApiKeysPage";
import ChangelogPage from "./pages/ChangelogPage";
import { UpdateModal } from "./components/UpdateModal";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
});

/**
 * api.ts'e token accessor'larını inject eder.
 * AuthContext mount olduğunda bir kez çalışır.
 */
function TokenInjector() {
  const { getAccessToken, setAccessToken } = useAuthContext();

  useEffect(() => {
    setTokenAccessors(getAccessToken, setAccessToken);
  }, [getAccessToken, setAccessToken]);

  return null;
}

/**
 * Kimlik doğrulaması gerekli sayfalar.
 * - isLoading: refresh token kontrol ediliyor → boş bekle
 * - isAuthenticated: accessToken memory'de var → render et
 * - aksi hâlde login'e yönlendir
 */
function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuthContext();

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="h-4 w-4 animate-spin rounded-full border-2 border-border border-t-foreground" />
      </div>
    );
  }

  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return (
    <AppShell>
      <UpdateModal />
      {children}
    </AppShell>
  );
}

/**
 * SetupGuard — uygulama ilk yüklendiğinde /setup/status kontrol eder.
 * configured=false ise tüm route'ları /setup'a yönlendirir.
 * configured=true ise normal akış devam eder.
 *
 * isLoading ve isError (API henüz hazır değil, retry devam ediyor) → spinner.
 * Tüm retry'lar bitip hâlâ hata varsa → setup sayfasına yönlendirir.
 * Bu sayede "API henüz ayakta değil" durumu setup sayfası açmasına yol açmaz.
 */
function SetupGuard({ children }: { children: React.ReactNode }) {
  const { data, isLoading, isError, failureCount } = useSetupStatus();

  // API'ye ulaşılamıyor: retry'lar sürüyor → spinner göster, setup'a atma
  // failureCount < 5: henüz tüm retry'lar bitmedi
  if (isLoading || (isError && failureCount < 5)) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="h-4 w-4 animate-spin rounded-full border-2 border-border border-t-foreground" />
      </div>
    );
  }

  // Kurulum tamamlanmamış (veya tüm retry'lar başarısız — API tamamen erişilemez)
  if (!data?.configured) {
    return (
      <Routes>
        <Route path="/setup" element={<SetupPage />} />
        <Route path="*" element={<Navigate to="/setup" replace />} />
      </Routes>
    );
  }

  return <>{children}</>;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <TokenInjector />
          <SetupGuard>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/setup" element={<Navigate to="/" replace />} />

              <Route
                path="/"
                element={
                  <ProtectedLayout>
                    <DashboardPage />
                  </ProtectedLayout>
                }
              />
              <Route
                path="/databases"
                element={
                  <ProtectedLayout>
                    <DatabasesPage />
                  </ProtectedLayout>
                }
              />
              <Route
                path="/databases/:db"
                element={
                  <ProtectedLayout>
                    <DatabasePage />
                  </ProtectedLayout>
                }
              />
              <Route
                path="/databases/:db/new-table"
                element={
                  <ProtectedLayout>
                    <CreateTablePage />
                  </ProtectedLayout>
                }
              />
              <Route
                path="/databases/:db/tables/:table"
                element={
                  <ProtectedLayout>
                    <TablePage />
                  </ProtectedLayout>
                }
              />
              <Route
                path="/query"
                element={
                  <ProtectedLayout>
                    <QueryPage />
                  </ProtectedLayout>
                }
              />
              <Route
                path="/api-keys"
                element={
                  <ProtectedLayout>
                    <ApiKeysPage />
                  </ProtectedLayout>
                }
              />

              <Route
                path="/changelog"
                element={
                  <ProtectedLayout>
                    <ChangelogPage />
                  </ProtectedLayout>
                }
              />

              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </SetupGuard>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}