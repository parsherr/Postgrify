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
    return (_jsxs("header", { className: "flex h-10 shrink-0 items-center justify-between border-b border-border bg-card px-3", children: [_jsxs("nav", { className: "flex items-center gap-1 text-sm", children: [_jsxs(Link, { to: "/", className: "flex items-center gap-1.5 font-semibold text-foreground", children: [_jsx("img", { src: "/logo.png", alt: "Postgrify", className: "h-5 w-5 object-contain" }), _jsx("span", { className: "hidden text-sm sm:block", children: "Postgrify" })] }), crumbs.map((crumb, i) => (_jsxs("span", { className: "flex items-center gap-1", children: [_jsx(ChevronRight, { className: "h-3 w-3 text-muted-foreground/40" }), i === crumbs.length - 1 ? (_jsx("span", { className: "font-mono text-xs text-foreground", children: crumb.label })) : (_jsx(Link, { to: crumb.to, className: "font-mono text-xs text-muted-foreground transition-colors hover:text-foreground", children: crumb.label }))] }, crumb.to)))] }), _jsxs("div", { className: "flex items-center gap-2", children: [databases && databases.length > 0 && (_jsxs(DropdownMenu, { children: [_jsx(DropdownMenuTrigger, { asChild: true, children: _jsxs("button", { className: "flex items-center gap-1.5 rounded border border-border px-2 py-1 font-mono text-xs text-muted-foreground transition-colors hover:border-zinc-600 hover:text-foreground", children: [_jsx(Database, { className: "h-3 w-3" }), activeDb ?? "DB seç"] }) }), _jsxs(DropdownMenuContent, { align: "end", className: "w-48", children: [_jsx(DropdownMenuSeparator, {}), databases.map((d) => (_jsxs(DropdownMenuItem, { onClick: () => navigate(`/databases/${d.name}`), className: cn("font-mono text-xs", d.name === activeDb && "bg-accent/50"), children: [_jsx(Database, { className: "mr-2 h-3 w-3" }), d.name, d.name === activeDb && (_jsx("span", { className: "ml-auto h-1.5 w-1.5 rounded-full bg-green-500" }))] }, d.name))), _jsx(DropdownMenuSeparator, {}), _jsxs(DropdownMenuItem, { onClick: () => navigate("/query"), className: "text-xs", children: [_jsx(Terminal, { className: "mr-2 h-3 w-3" }), "SQL Edit\u00F6r\u00FC"] })] })] })), _jsx("button", { onClick: handleLogout, className: "flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground", title: "\u00C7\u0131k\u0131\u015F", children: _jsx(LogOut, { className: "h-3.5 w-3.5" }) })] })] }));
}
