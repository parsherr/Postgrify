import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * Sidebar — tree-nav ile DB/tablo navigasyonu.
 * VSCode tarzı alt panel (slide-up mini SQL editörü) ve version satırı içerir.
 */
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { LayoutDashboard, Terminal, KeyRound, Database, Plus, LogOut, ExternalLink, } from "lucide-react";
import { cn } from "@/lib/utils";
import { useDatabases } from "@/hooks/useDatabases";
import { useAuthContext } from "@/hooks/useAuthContext";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Separator } from "@/components/ui/separator";
const VERSION = import.meta.env.VITE_APP_VERSION ?? "0.1.0";
const navItems = [
    { label: "Dashboard", to: "/", icon: LayoutDashboard },
    { label: "Veritabanları", to: "/databases", icon: Database },
    { label: "SQL Editörü", to: "/query", icon: Terminal },
    { label: "API Keys", to: "/api-keys", icon: KeyRound },
];
/** Tek bir veritabanının sidebar satırını gösterir */
function DbTreeNode({ dbName, collapsed, }) {
    const params = useParams();
    const isActiveDb = params.db === dbName;
    const dbPath = `/databases/${dbName}`;
    return (_jsx(TooltipProvider, { delayDuration: 0, children: _jsxs(Tooltip, { children: [_jsx(TooltipTrigger, { asChild: true, children: _jsx(Link, { to: dbPath, className: cn("flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm transition-colors", isActiveDb
                            ? "border-l-2 border-zinc-400 bg-zinc-800/60 pl-1.5 text-foreground"
                            : "border-l-2 border-transparent text-muted-foreground hover:bg-accent/50 hover:text-foreground", collapsed && "justify-center px-0"), children: collapsed ? (_jsx(Database, { className: "h-3.5 w-3.5 mx-auto" })) : (_jsxs(_Fragment, { children: [_jsx(Database, { className: "h-3.5 w-3.5 shrink-0" }), _jsx("span", { className: "flex-1 truncate font-mono text-xs", children: dbName })] })) }) }), collapsed && (_jsx(TooltipContent, { side: "right", className: "font-mono text-xs", children: dbName }))] }) }));
}
export function Sidebar({ collapsed }) {
    const location = useLocation();
    const navigate = useNavigate();
    const { data: databases } = useDatabases();
    const { logout } = useAuthContext();
    async function handleLogout() {
        await logout();
        navigate("/login");
    }
    return (_jsxs("div", { className: "flex h-full flex-col text-sm", children: [_jsxs("div", { className: "flex-1 overflow-y-auto py-2", children: [_jsx("nav", { className: "space-y-0.5 px-2", children: navItems.map(({ label, to, icon: Icon }) => {
                            const active = to === "/" ? location.pathname === "/" : location.pathname.startsWith(to);
                            return (_jsx(TooltipProvider, { delayDuration: 0, children: _jsxs(Tooltip, { children: [_jsx(TooltipTrigger, { asChild: true, children: _jsxs(Link, { to: to, className: cn("flex items-center gap-2 rounded-sm px-2 py-1.5 transition-colors", active
                                                    ? "bg-accent/60 text-foreground"
                                                    : "text-muted-foreground hover:bg-accent/40 hover:text-foreground", collapsed && "justify-center px-0"), children: [_jsx(Icon, { className: "h-4 w-4 shrink-0" }), !collapsed && _jsx("span", { children: label })] }) }), collapsed && (_jsx(TooltipContent, { side: "right", children: label }))] }) }, to));
                        }) }), _jsx(Separator, { className: "my-2" }), !collapsed && (_jsx("div", { className: "mb-1 px-3", children: _jsx("span", { className: "text-2xs font-semibold uppercase tracking-widest text-muted-foreground/60", children: "Databases" }) })), _jsxs("div", { className: "space-y-0.5 px-2", children: [databases?.map((db) => (_jsx(DbTreeNode, { dbName: db.name, collapsed: collapsed }, db.name))), _jsx(TooltipProvider, { delayDuration: 0, children: _jsxs(Tooltip, { children: [_jsx(TooltipTrigger, { asChild: true, children: _jsxs(Link, { to: "/databases", className: cn("flex items-center gap-2 rounded-sm px-2 py-1.5 text-muted-foreground/50 transition-colors hover:text-muted-foreground", collapsed && "justify-center px-0"), children: [_jsx(Plus, { className: "h-3.5 w-3.5 shrink-0" }), !collapsed && _jsx("span", { className: "text-xs", children: "Veritaban\u0131 Ekle" })] }) }), collapsed && (_jsx(TooltipContent, { side: "right", children: "Veritaban\u0131 Ekle" }))] }) })] })] }), _jsxs("div", { className: "flex flex-col", children: [_jsx(Separator, {}), _jsx("div", { className: "px-2 py-0.5", children: _jsx(TooltipProvider, { delayDuration: 0, children: _jsxs(Tooltip, { children: [_jsx(TooltipTrigger, { asChild: true, children: _jsxs("a", { href: "http://localhost:3000/api-docs", target: "_blank", rel: "noopener noreferrer", className: cn("flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-xs text-muted-foreground/60 transition-colors hover:text-muted-foreground", collapsed && "justify-center px-0"), children: [_jsx(ExternalLink, { className: "h-3.5 w-3.5 shrink-0" }), !collapsed && _jsx("span", { children: "API Docs" })] }) }), collapsed && (_jsx(TooltipContent, { side: "right", children: "API Docs" }))] }) }) }), _jsx("div", { className: "px-2 py-1.5", children: _jsx(TooltipProvider, { delayDuration: 0, children: _jsxs(Tooltip, { children: [_jsx(TooltipTrigger, { asChild: true, children: _jsxs("button", { onClick: handleLogout, className: cn("flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-xs text-muted-foreground/60 transition-colors hover:text-muted-foreground", collapsed && "justify-center px-0"), children: [_jsx(LogOut, { className: "h-3.5 w-3.5 shrink-0" }), !collapsed && _jsx("span", { children: "\u00C7\u0131k\u0131\u015F" })] }) }), collapsed && (_jsx(TooltipContent, { side: "right", children: "\u00C7\u0131k\u0131\u015F" }))] }) }) }), !collapsed && (_jsxs("div", { className: "flex items-center justify-between border-t border-border/50 px-3 py-1.5", children: [_jsxs("span", { className: "font-mono text-2xs text-muted-foreground/40", children: ["v", VERSION] }), _jsx("img", { src: "/black-white-logo.png", alt: "", className: "h-5 w-5 object-contain" })] }))] })] }));
}
