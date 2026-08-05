/**
 * Uygulama kökü — routing ve layout.
 */

import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Sidebar from "./components/layout/Sidebar.js";
import Header from "./components/layout/Header.js";
import LoginPage from "./pages/LoginPage.js";
import DashboardPage from "./pages/DashboardPage.js";
import DatabasesPage from "./pages/DatabasesPage.js";
import DatabasePage from "./pages/DatabasePage.js";
import TablePage from "./pages/TablePage.js";
import CreateTablePage from "./pages/CreateTablePage.js";
import QueryPage from "./pages/QueryPage.js";
import ApiKeysPage from "./pages/ApiKeysPage.js";
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

  return (
    <div className="flex h-screen bg-gray-50">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header />
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}

function Protected({ children }: { children: React.ReactNode }) {
  return <ProtectedLayout>{children}</ProtectedLayout>;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />

          <Route path="/" element={<Protected><DashboardPage /></Protected>} />
          <Route path="/databases" element={<Protected><DatabasesPage /></Protected>} />
          <Route path="/databases/:db" element={<Protected><DatabasePage /></Protected>} />
          <Route path="/databases/:db/new-table" element={<Protected><CreateTablePage /></Protected>} />
          <Route path="/databases/:db/tables/:table" element={<Protected><TablePage /></Protected>} />
          <Route path="/query" element={<Protected><QueryPage /></Protected>} />
          <Route path="/api-keys" element={<Protected><ApiKeysPage /></Protected>} />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}