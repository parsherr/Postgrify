import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * TopBar — breadcrumb, aktif DB badge'i, kullanıcı menüsü.
 * Header.tsx'in yeni versiyonu.
 */
import { useLocation, useParams, Link, useNavigate } from "react-router-dom";
import { ChevronRight, Database, LogOut, Terminal } from "lucide-react";
import { cn } from "@/lib/utils";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, } from "@/components/ui/dropdown-menu";
import { useDatabases } from "@/hooks/useDatabases";
import { useAuthContext } from "@/hooks/useAuthContext";
function useBreadcrumbs() {
    const location = useLocation();
    const { db, table } = useParams();
    const parts = location.pathname.split("/").filter(Boolean);
    const crumbs = [];
    if (parts.length === 0) {
        crumbs.push({ label: "Dashboard", to: "/" });
    }
    else if (parts[0] === "databases") {
        crumbs.push({ label: "Databases", to: "/databases" });
        if (db) {
            crumbs.push({ label: db, to: `/databases/${db}` });
            if (table)
                crumbs.push({ label: table, to: `/databases/${db}/tables/${table}` });
            if (parts.includes("new-table"))
                crumbs.push({ label: "New Table", to: `/databases/${db}/new-table` });
        }
    }
    else if (parts[0] === "query") {
        crumbs.push({ label: "SQL Editor", to: "/query" });
    }
    else if (parts[0] === "api-keys") {
        crumbs.push({ label: "API Keys", to: "/api-keys" });
    }
    return crumbs;
}
export function TopBar() {
    const crumbs = useBreadcrumbs();
    const navigate = useNavigate();
    const { db: activeDb } = useParams();
    const { data: databases } = useDatabases();
    const { logout } = useAuthContext();
    async function handleLogout() {
        await logout();
        navigate("/login");
    }
    return (_jsxs("header", { className: "flex h-12 shrink-0 items-center justify-between border-b border-zinc-800 bg-zinc-950 px-4", children: [_jsxs("nav", { className: "flex items-center gap-1 text-sm", children: [_jsxs(Link, { to: "/", className: "flex items-center gap-1.5 font-semibold text-white", children: [_jsx("img", { src: "/black-white-logo.png", alt: "Postgrify", className: "h-7 w-7 object-contain" }), _jsx("span", { className: "hidden text-sm sm:block", children: "Postgrify" })] }), crumbs.map((crumb, i) => (_jsxs("span", { className: "flex items-center gap-1", children: [_jsx(ChevronRight, { className: "h-3 w-3 text-zinc-700" }), i === crumbs.length - 1 ? (_jsx("span", { className: "font-mono text-xs text-white", children: crumb.label })) : (_jsx(Link, { to: crumb.to, className: "font-mono text-xs text-zinc-400 transition-colors hover:text-white", children: crumb.label }))] }, crumb.to)))] }), _jsxs("div", { className: "flex items-center gap-2", children: [databases && databases.length > 0 && (_jsxs(DropdownMenu, { children: [_jsx(DropdownMenuTrigger, { asChild: true, children: _jsxs("button", { className: "flex items-center gap-1.5 rounded border border-zinc-700 px-2 py-1 font-mono text-xs text-zinc-400 transition-colors hover:border-zinc-500 hover:text-white", children: [_jsx(Database, { className: "h-3 w-3" }), activeDb ?? "DB seç"] }) }), _jsxs(DropdownMenuContent, { align: "end", className: "w-48", children: [_jsx(DropdownMenuSeparator, {}), databases.map((d) => (_jsxs(DropdownMenuItem, { onClick: () => navigate(`/databases/${d.name}`), className: cn("font-mono text-xs", d.name === activeDb && "bg-zinc-800"), children: [_jsx(Database, { className: "mr-2 h-3 w-3" }), d.name, d.name === activeDb && (_jsx("span", { className: "ml-auto h-1.5 w-1.5 rounded-full bg-green-500" }))] }, d.name))), _jsx(DropdownMenuSeparator, {}), _jsxs(DropdownMenuItem, { onClick: () => navigate("/query"), className: "text-xs", children: [_jsx(Terminal, { className: "mr-2 h-3 w-3" }), "SQL Edit\u00F6r\u00FC"] })] })] })), _jsx("button", { onClick: handleLogout, className: "flex items-center gap-1 rounded px-2 py-1 text-xs text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-white", title: "\u00C7\u0131k\u0131\u015F", children: _jsx(LogOut, { className: "h-3.5 w-3.5" }) })] })] }));
}
