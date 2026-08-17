/**
 * Application root — routing and layout.
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
 * Injects token accessors into api.ts.
 * Runs once when AuthContext mounts.
 */
function TokenInjector() {
  const { getAccessToken, setAccessToken } = useAuthContext();

  useEffect(() => {
    setTokenAccessors(getAccessToken, setAccessToken);
  }, [getAccessToken, setAccessToken]);

  return null;
}

/**
 * Pages that require authentication.
 * - isLoading: refresh token is being checked → show spinner
 * - isAuthenticated: accessToken is in memory → render
 * - otherwise: redirect to login
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
 * SetupGuard — checks /setup/status on initial app load.
 * If configured=false, redirects all routes to /setup.
 * If configured=true, normal flow continues.
 *
 * isLoading and isError (API not ready yet, retries ongoing) → spinner.
 * If all retries are exhausted and still erroring → redirects to setup page.
 * This prevents "API not yet available" from incorrectly triggering the setup page.
 */
function SetupGuard({ children }: { children: React.ReactNode }) {
  const { data, isLoading, isError, failureCount } = useSetupStatus();

  // API unreachable: retries ongoing → show spinner, don't redirect to setup
  // failureCount < 5: not all retries exhausted yet
  if (isLoading || (isError && failureCount < 5)) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="h-4 w-4 animate-spin rounded-full border-2 border-border border-t-foreground" />
      </div>
    );
  }

  // Setup not complete (or all retries failed — API completely unreachable)
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