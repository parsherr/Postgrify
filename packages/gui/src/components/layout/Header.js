import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * Üst başlık çubuğu — sayfa başlığı ve breadcrumb.
 */
import { useLocation, useParams, Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";
function useBreadcrumbs() {
    const location = useLocation();
    const { db, table } = useParams();
    const parts = location.pathname.split("/").filter(Boolean);
    const crumbs = [
        { label: "Dashboard", to: "/" },
    ];
    if (parts[0] === "databases") {
        crumbs.push({ label: "Veritabanları", to: "/databases" });
        if (db) {
            crumbs.push({ label: db, to: `/databases/${db}` });
            if (table) {
                crumbs.push({ label: table, to: `/databases/${db}/tables/${table}` });
            }
            if (parts.includes("new-table")) {
                crumbs.push({ label: "Yeni Tablo", to: `/databases/${db}/new-table` });
            }
        }
    }
    else if (parts[0] === "query") {
        crumbs.push({ label: "SQL Editörü", to: "/query" });
    }
    else if (parts[0] === "api-keys") {
        crumbs.push({ label: "API Keys", to: "/api-keys" });
    }
    return crumbs;
}
export default function Header() {
    const crumbs = useBreadcrumbs();
    if (crumbs.length <= 1)
        return null;
    return (_jsx("div", { className: "px-6 py-3 border-b border-gray-100 bg-white", children: _jsx("nav", { className: "flex items-center gap-1 text-sm", children: crumbs.map((crumb, i) => (_jsxs("span", { className: "flex items-center gap-1", children: [i > 0 && _jsx(ChevronRight, { className: "w-3.5 h-3.5 text-gray-300" }), i === crumbs.length - 1 ? (_jsx("span", { className: "text-gray-700 font-medium", children: crumb.label })) : (_jsx(Link, { to: crumb.to, className: "text-gray-400 hover:text-gray-600 transition-colors", children: crumb.label }))] }, crumb.to))) }) }));
}
