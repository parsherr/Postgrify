import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * QueryHistory — son 20 sorgu, localStorage'da saklanır.
 */
import React from "react";
import { Clock, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger, } from "@/components/ui/dropdown-menu";
const HISTORY_KEY = "postgrify_query_history";
const MAX_HISTORY = 20;
export function loadHistory() {
    try {
        return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]");
    }
    catch {
        return [];
    }
}
export function saveToHistory(entry) {
    const history = loadHistory().filter((h) => h.sql !== entry.sql || h.db !== entry.db);
    history.unshift(entry);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, MAX_HISTORY)));
}
export function QueryHistory({ onSelect }) {
    const [history, setHistory] = React.useState(loadHistory);
    const [open, setOpen] = React.useState(false);
    function refresh() {
        setHistory(loadHistory());
    }
    function clearHistory() {
        localStorage.removeItem(HISTORY_KEY);
        setHistory([]);
    }
    function formatTs(ts) {
        const d = new Date(ts);
        const now = Date.now();
        const diff = Math.floor((now - ts) / 1000);
        if (diff < 60)
            return "az önce";
        if (diff < 3600)
            return `${Math.floor(diff / 60)} dk önce`;
        if (diff < 86400)
            return `${Math.floor(diff / 3600)} sa önce`;
        return d.toLocaleDateString("tr-TR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
    }
    return (_jsxs(DropdownMenu, { open: open, onOpenChange: (o) => { setOpen(o); if (o)
            refresh(); }, children: [_jsx(DropdownMenuTrigger, { asChild: true, children: _jsxs(Button, { variant: "ghost", size: "sm", className: "gap-1.5 text-xs", children: [_jsx(Clock, { className: "h-3.5 w-3.5" }), "Ge\u00E7mi\u015F"] }) }), _jsxs(DropdownMenuContent, { align: "end", className: "w-80", children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsx(DropdownMenuLabel, { children: "Sorgu Ge\u00E7mi\u015Fi" }), history.length > 0 && (_jsx(Button, { variant: "ghost", size: "icon-sm", className: "mr-1 h-5 w-5 text-muted-foreground", onClick: clearHistory, title: "Ge\u00E7mi\u015Fi temizle", children: _jsx(Trash2, { className: "h-3 w-3" }) }))] }), _jsx(DropdownMenuSeparator, {}), history.length === 0 && (_jsx("div", { className: "px-3 py-4 text-center text-xs text-muted-foreground", children: "Hen\u00FCz sorgu yok" })), _jsx("div", { className: "max-h-64 overflow-y-auto", children: history.map((entry, i) => (_jsxs("button", { onClick: () => { onSelect(entry.sql); setOpen(false); }, className: "flex w-full flex-col gap-0.5 px-3 py-2 text-left transition-colors hover:bg-accent", children: [_jsx("span", { className: "block truncate font-mono text-xs text-foreground", children: entry.sql.replace(/\s+/g, " ").trim() }), _jsxs("div", { className: "flex items-center gap-1.5", children: [_jsx("span", { className: "font-mono text-2xs text-muted-foreground/60", children: entry.db }), _jsx("span", { className: "text-2xs text-muted-foreground/40", children: "\u00B7" }), _jsx("span", { className: "text-2xs text-muted-foreground/60", children: formatTs(entry.ts) })] })] }, i))) })] })] }));
}
