import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
/**
 * BottomPanel — Quick SQL editörü, tam genişlikte, AppShell'in altında.
 * ResizableHandle ile yukarı sürükleyerek açılır/büyütülür.
 * Varsayılan: kapalı (collapsedSize). Drag ile açılır.
 */
import React from "react";
import { Terminal, X, Play, ChevronUp } from "lucide-react";
import { ResizableHandle, ResizablePanel } from "@/components/ui/resizable";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useNavigate } from "react-router-dom";
const PANEL_STORAGE_KEY = "postgrify_bottom_panel_size";
export function SidebarBottomPanel() {
    const navigate = useNavigate();
    const [sql, setSql] = React.useState("SELECT 1;");
    const [result, setResult] = React.useState(null);
    const [error, setError] = React.useState(null);
    const [isRunning, setIsRunning] = React.useState(false);
    const textareaRef = React.useRef(null);
    const savedSize = React.useMemo(() => {
        const raw = localStorage.getItem(PANEL_STORAGE_KEY);
        const parsed = raw ? parseInt(raw, 10) : NaN;
        return isNaN(parsed) ? 32 : parsed; // 32px = kapalı (sadece header)
    }, []);
    async function runQuickSql() {
        if (!sql.trim() || isRunning)
            return;
        setIsRunning(true);
        setError(null);
        setResult(null);
        try {
            const token = localStorage.getItem("postgrify_token");
            // Token'dan DB'yi parse et (JWT payload)
            let db = "";
            if (token) {
                try {
                    const payload = JSON.parse(atob(token.split(".")[1]));
                    db = payload.database ?? payload.db ?? "";
                }
                catch { /* ignore */ }
            }
            if (!db) {
                setError("Önce bir veritabanı seçin");
                return;
            }
            const res = await fetch(`${import.meta.env.VITE_API_URL ?? "http://localhost:3000"}/db/${db}/query`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    ...(token ? { Authorization: `Bearer ${token}` } : {}),
                },
                body: JSON.stringify({ sql }),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({ error: res.statusText }));
                setError(err.error ?? res.statusText);
                return;
            }
            const data = await res.json();
            setResult(data);
        }
        catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        }
        finally {
            setIsRunning(false);
        }
    }
    function openInEditor() {
        navigate("/query", { state: { initialSql: sql } });
    }
    return (_jsxs(_Fragment, { children: [_jsx(ResizableHandle, { withHandle: true, className: "group border-t border-border" }), _jsxs(ResizablePanel, { id: "bottom-panel", defaultSize: `${savedSize}px`, minSize: "32px", maxSize: "60%", collapsible: true, collapsedSize: "32px", className: "flex flex-col border-t border-border bg-card", children: [_jsxs("div", { className: "flex h-8 shrink-0 items-center gap-2 border-b border-border/50 px-3", children: [_jsx(Terminal, { className: "h-3.5 w-3.5 text-muted-foreground/60" }), _jsx("span", { className: "text-xs font-medium text-muted-foreground", children: "Quick SQL" }), _jsx("div", { className: "flex-1" }), _jsxs("button", { onClick: openInEditor, className: "flex items-center gap-1 rounded px-1.5 py-0.5 text-2xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground", title: "Edit\u00F6rde A\u00E7", children: [_jsx(ChevronUp, { className: "h-3 w-3" }), "Edit\u00F6rde A\u00E7"] })] }), _jsxs("div", { className: "flex min-h-0 flex-1 flex-col overflow-hidden", children: [_jsxs("div", { className: "flex min-h-0 flex-1 overflow-hidden", children: [_jsx("textarea", { ref: textareaRef, value: sql, onChange: (e) => setSql(e.target.value), onKeyDown: (e) => {
                                            if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                                                e.preventDefault();
                                                runQuickSql();
                                            }
                                        }, spellCheck: false, className: cn("flex-1 resize-none bg-transparent p-3 font-mono text-xs text-foreground", "placeholder:text-muted-foreground/40 focus:outline-none"), placeholder: "SELECT * FROM users LIMIT 10;" }), _jsx("div", { className: "flex shrink-0 flex-col gap-2 border-l border-border/50 p-2", children: _jsxs(Button, { size: "sm", onClick: runQuickSql, disabled: !sql.trim() || isRunning, className: "h-7 gap-1 px-2 text-xs", children: [_jsx(Play, { className: "h-3 w-3" }), isRunning ? "…" : "Çalıştır"] }) })] }), (result || error) && (_jsx("div", { className: "max-h-32 overflow-y-auto border-t border-border/50", children: error ? (_jsxs("div", { className: "flex items-start gap-2 p-2", children: [_jsx(X, { className: "mt-0.5 h-3 w-3 shrink-0 text-red-400" }), _jsx("span", { className: "font-mono text-xs text-red-400", children: error })] })) : result && result.rows.length > 0 ? (_jsxs("div", { className: "overflow-x-auto", children: [_jsxs("table", { className: "w-full text-xs", children: [_jsx("thead", { children: _jsx("tr", { className: "border-b border-border/40", children: Object.keys(result.rows[0]).map((col) => (_jsx("th", { className: "px-3 py-1 text-left font-mono text-2xs text-muted-foreground/60", children: col }, col))) }) }), _jsx("tbody", { children: result.rows.slice(0, 5).map((row, i) => (_jsx("tr", { className: "border-b border-border/20 hover:bg-accent/10", children: Object.values(row).map((val, j) => (_jsx("td", { className: "px-3 py-1 font-mono text-xs text-foreground/80", children: val === null ? (_jsx("span", { className: "text-muted-foreground/40", children: "null" })) : (String(val)) }, j))) }, i))) })] }), result.rows.length > 5 && (_jsxs("div", { className: "px-3 py-1 text-2xs text-muted-foreground/50", children: ["+", result.rows.length - 5, " sat\u0131r daha \u2014 edit\u00F6rde a\u00E7"] }))] })) : (_jsxs("div", { className: "px-3 py-2 text-xs text-muted-foreground", children: [result?.count ?? 0, " sat\u0131r d\u00F6nd\u00FC"] })) }))] })] })] }));
}
