import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
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
const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            staleTime: 30000,
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
function ProtectedLayout({ children }) {
    const { isAuthenticated, isLoading } = useAuthContext();
    if (isLoading) {
        return (_jsx("div", { className: "flex h-screen items-center justify-center bg-background", children: _jsx("div", { className: "h-4 w-4 animate-spin rounded-full border-2 border-border border-t-foreground" }) }));
    }
    if (!isAuthenticated)
        return _jsx(Navigate, { to: "/login", replace: true });
    return _jsx(AppShell, { children: children });
}
/**
 * SetupGuard — uygulama ilk yüklendiğinde /setup/status kontrol eder.
 * configured=false ise tüm route'ları /setup'a yönlendirir.
 * configured=true ise normal akış devam eder.
 */
function SetupGuard({ children }) {
    const { data, isLoading } = useSetupStatus();
    if (isLoading) {
        return (_jsx("div", { className: "flex h-screen items-center justify-center bg-background", children: _jsx("div", { className: "h-4 w-4 animate-spin rounded-full border-2 border-border border-t-foreground" }) }));
    }
    // API'ye erişilemiyorsa veya kurulum tamamlanmamışsa → setup
    if (!data?.configured) {
        return (_jsxs(Routes, { children: [_jsx(Route, { path: "/setup", element: _jsx(SetupPage, {}) }), _jsx(Route, { path: "*", element: _jsx(Navigate, { to: "/setup", replace: true }) })] }));
    }
    return _jsx(_Fragment, { children: children });
}
export default function App() {
    return (_jsx(QueryClientProvider, { client: queryClient, children: _jsx(BrowserRouter, { children: _jsx(SetupGuard, { children: _jsxs(AuthProvider, { children: [_jsx(TokenInjector, {}), _jsxs(Routes, { children: [_jsx(Route, { path: "/login", element: _jsx(LoginPage, {}) }), _jsx(Route, { path: "/setup", element: _jsx(Navigate, { to: "/", replace: true }) }), _jsx(Route, { path: "/", element: _jsx(ProtectedLayout, { children: _jsx(DashboardPage, {}) }) }), _jsx(Route, { path: "/databases", element: _jsx(ProtectedLayout, { children: _jsx(DatabasesPage, {}) }) }), _jsx(Route, { path: "/databases/:db", element: _jsx(ProtectedLayout, { children: _jsx(DatabasePage, {}) }) }), _jsx(Route, { path: "/databases/:db/new-table", element: _jsx(ProtectedLayout, { children: _jsx(CreateTablePage, {}) }) }), _jsx(Route, { path: "/databases/:db/tables/:table", element: _jsx(ProtectedLayout, { children: _jsx(TablePage, {}) }) }), _jsx(Route, { path: "/query", element: _jsx(ProtectedLayout, { children: _jsx(QueryPage, {}) }) }), _jsx(Route, { path: "/api-keys", element: _jsx(ProtectedLayout, { children: _jsx(ApiKeysPage, {}) }) }), _jsx(Route, { path: "*", element: _jsx(Navigate, { to: "/", replace: true }) })] })] }) }) }) }));
}
