/**
 * Uygulama kökü — routing ve layout.
 */

import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AppShell } from "./components/layout/AppShell";
import LoginPage from "./pages/LoginPage";
import DashboardPage from "./pages/DashboardPage";
import DatabasesPage from "./pages/DatabasesPage";
import DatabasePage from "./pages/DatabasePage";
import TablePage from "./pages/TablePage";
import CreateTablePage from "./pages/CreateTablePage";
import QueryPage from "./pages/QueryPage";
import ApiKeysPage from "./pages/ApiKeysPage";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
});

function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const authenticated = !!localStorage.getItem("postgrify_token");
  if (!authenticated) return <Navigate to="/login" replace />;
  return <AppShell>{children}</AppShell>;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />

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

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}