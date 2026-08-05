import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
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
            staleTime: 30000,
            retry: 1,
        },
    },
});
function ProtectedLayout({ children }) {
    const authenticated = !!localStorage.getItem("postgrify_token");
    if (!authenticated)
        return _jsx(Navigate, { to: "/login", replace: true });
    return _jsx(AppShell, { children: children });
}
export default function App() {
    return (_jsx(QueryClientProvider, { client: queryClient, children: _jsx(BrowserRouter, { children: _jsxs(Routes, { children: [_jsx(Route, { path: "/login", element: _jsx(LoginPage, {}) }), _jsx(Route, { path: "/", element: _jsx(ProtectedLayout, { children: _jsx(DashboardPage, {}) }) }), _jsx(Route, { path: "/databases", element: _jsx(ProtectedLayout, { children: _jsx(DatabasesPage, {}) }) }), _jsx(Route, { path: "/databases/:db", element: _jsx(ProtectedLayout, { children: _jsx(DatabasePage, {}) }) }), _jsx(Route, { path: "/databases/:db/new-table", element: _jsx(ProtectedLayout, { children: _jsx(CreateTablePage, {}) }) }), _jsx(Route, { path: "/databases/:db/tables/:table", element: _jsx(ProtectedLayout, { children: _jsx(TablePage, {}) }) }), _jsx(Route, { path: "/query", element: _jsx(ProtectedLayout, { children: _jsx(QueryPage, {}) }) }), _jsx(Route, { path: "/api-keys", element: _jsx(ProtectedLayout, { children: _jsx(ApiKeysPage, {}) }) }), _jsx(Route, { path: "*", element: _jsx(Navigate, { to: "/", replace: true }) })] }) }) }));
}
