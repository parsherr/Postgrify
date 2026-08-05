import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
/**
 * ApiKeysPage — DB token oluşturma (Sheet drawer).
 * Mevcut useDbToken hook'unu kullanır.
 */
import React from "react";
import { Copy, Plus, Check, KeyRound, Loader2 } from "lucide-react";
import { useDatabases } from "@/hooks/useDatabases";
import { useDbToken } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter, } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, } from "@/components/ui/select";
import { cn } from "@/lib/utils";
const SCOPES = ["read", "write", "delete", "schema", "query"];
const SCOPE_COLORS = {
    read: "text-zinc-300 border-zinc-700 bg-zinc-800/50",
    write: "text-amber-400/80 border-amber-900/50 bg-amber-950/30",
    delete: "text-red-400/80 border-red-900/50 bg-red-950/30",
    schema: "text-blue-400/80 border-blue-900/50 bg-blue-950/30",
    query: "text-emerald-400/80 border-emerald-900/50 bg-emerald-950/30",
};
const EXPIRY_OPTIONS = [
    { label: "1 saat", value: "1h" },
    { label: "1 gün", value: "24h" },
    { label: "7 gün", value: "7d" },
    { label: "30 gün", value: "30d" },
    { label: "90 gün", value: "90d" },
    { label: "1 yıl", value: "365d" },
];
function CopyButton({ value }) {
    const [copied, setCopied] = React.useState(false);
    function copy() {
        navigator.clipboard.writeText(value).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        });
    }
    return (_jsxs("button", { onClick: copy, className: "flex items-center gap-1 rounded px-2 py-1 text-2xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground", children: [copied ? (_jsx(Check, { className: "h-3 w-3 text-green-500" })) : (_jsx(Copy, { className: "h-3 w-3" })), copied ? "Kopyalandı" : "Kopyala"] }));
}
export default function ApiKeysPage() {
    const { data: databases } = useDatabases();
    const { mutateAsync: createToken, isPending: creating } = useDbToken();
    const [drawerOpen, setDrawerOpen] = React.useState(false);
    const [newToken, setNewToken] = React.useState(null);
    // Form state
    const [formDb, setFormDb] = React.useState("");
    const [formSecret, setFormSecret] = React.useState("");
    const [formScopes, setFormScopes] = React.useState(["read"]);
    const [formExpiry, setFormExpiry] = React.useState("30d");
    const [formError, setFormError] = React.useState(null);
    function toggleScope(scope) {
        setFormScopes((prev) => prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope]);
    }
    function openDrawer() {
        setFormDb("");
        setFormSecret("");
        setFormScopes(["read"]);
        setFormExpiry("30d");
        setFormError(null);
        setNewToken(null);
        setDrawerOpen(true);
    }
    async function handleCreate() {
        if (!formDb || formScopes.length === 0) {
            setFormError("Veritabanı ve en az bir scope seçin");
            return;
        }
        if (!formSecret.trim()) {
            setFormError("DB Secret gerekli");
            return;
        }
        setFormError(null);
        try {
            const result = await createToken({
                database: formDb,
                secret: formSecret.trim(),
                scope: formScopes,
                expiresIn: formExpiry,
            });
            setNewToken(result.token);
        }
        catch (err) {
            setFormError(err instanceof Error ? err.message : "Oluşturulamadı");
        }
    }
    return (_jsxs("div", { className: "flex h-full flex-col gap-6 overflow-y-auto p-6", children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsxs("div", { children: [_jsx("h1", { className: "text-base font-semibold text-foreground", children: "API Keys" }), _jsx("p", { className: "mt-0.5 text-xs text-muted-foreground", children: "Veritaban\u0131 bazl\u0131 JWT token'lar\u0131 olu\u015Ftur" })] }), _jsxs(Button, { size: "sm", onClick: openDrawer, className: "gap-1.5", children: [_jsx(Plus, { className: "h-3.5 w-3.5" }), "Token Olu\u015Ftur"] })] }), _jsx("div", { className: "rounded border border-border bg-card p-4", children: _jsxs("div", { className: "flex items-start gap-3", children: [_jsx(KeyRound, { className: "mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/50" }), _jsxs("div", { className: "space-y-1", children: [_jsx("p", { className: "text-xs font-medium text-foreground", children: "Token Yap\u0131s\u0131" }), _jsx("p", { className: "text-xs text-muted-foreground", children: "Her token tek bir veritaban\u0131na ve belirli scope'lara (izinlere) ba\u011Fl\u0131d\u0131r. Token'lar JWT format\u0131nda imzalan\u0131r ve yaln\u0131zca olu\u015Fturuldu\u011Fu anda g\u00F6r\u00FCnt\u00FClenir." }), _jsx("div", { className: "mt-2 flex flex-wrap gap-1.5", children: SCOPES.map((scope) => (_jsx("span", { className: cn("inline-flex items-center rounded-sm border px-1.5 py-0.5 font-mono text-2xs", SCOPE_COLORS[scope]), children: scope }, scope))) })] })] }) }), _jsx(TokenHistory, {}), _jsx(Sheet, { open: drawerOpen, onOpenChange: setDrawerOpen, children: _jsxs(SheetContent, { side: "right", className: "flex w-96 flex-col gap-0 p-0", children: [_jsxs(SheetHeader, { className: "border-b border-border px-6 py-4", children: [_jsx(SheetTitle, { children: "Token Olu\u015Ftur" }), _jsx(SheetDescription, { children: "Veritaban\u0131 eri\u015Fim token'\u0131 olu\u015Fturur. Token yaln\u0131zca bir kez g\u00F6sterilir." })] }), _jsx("div", { className: "flex-1 overflow-y-auto px-6 py-4", children: newToken ? (_jsxs("div", { className: "space-y-4", children: [_jsxs("div", { className: "rounded border border-green-900/50 bg-green-950/30 p-4", children: [_jsx("p", { className: "mb-2 text-xs font-medium text-green-400", children: "Token olu\u015Fturuldu!" }), _jsx("p", { className: "mb-3 text-2xs text-muted-foreground", children: "Bu token yaln\u0131zca \u015Fu an g\u00F6r\u00FCn\u00FCr. Kopyalay\u0131n ve g\u00FCvende saklay\u0131n." }), _jsx("div", { className: "flex items-start gap-2 rounded border border-border bg-background p-3", children: _jsx("code", { className: "flex-1 break-all font-mono text-2xs text-foreground", children: newToken }) }), _jsx("div", { className: "mt-2", children: _jsx(CopyButton, { value: newToken }) })] }), _jsx(Button, { variant: "outline", className: "w-full", onClick: () => {
                                            // Geçmişe kaydet
                                            addToLocalHistory({ db: formDb, scopes: formScopes, expiry: formExpiry, token: newToken });
                                            setNewToken(null);
                                            setDrawerOpen(false);
                                        }, children: "Kapat" })] })) : (_jsxs("div", { className: "space-y-5", children: [_jsxs("div", { className: "space-y-1.5", children: [_jsx(Label, { children: "Veritaban\u0131" }), _jsxs(Select, { value: formDb, onValueChange: setFormDb, children: [_jsx(SelectTrigger, { className: "text-xs", children: _jsx(SelectValue, { placeholder: "Veritaban\u0131 se\u00E7in\u2026" }) }), _jsx(SelectContent, { children: databases?.map((db) => (_jsx(SelectItem, { value: db.name, className: "font-mono text-xs", children: db.name }, db.name))) })] })] }), _jsxs("div", { className: "space-y-1.5", children: [_jsx(Label, { children: "DB Secret" }), _jsx(Input, { type: "password", value: formSecret, onChange: (e) => setFormSecret(e.target.value), placeholder: "DB_SECRET_xxx veya ADMIN_SECRET", className: "font-mono text-xs" }), _jsx("p", { className: "text-2xs text-muted-foreground", children: "Env'deki DB_SECRET_<DB> veya ADMIN_SECRET" })] }), _jsxs("div", { className: "space-y-2", children: [_jsx(Label, { children: "\u0130zinler (Scope)" }), _jsx("div", { className: "flex flex-wrap gap-2", children: SCOPES.map((scope) => {
                                                    const active = formScopes.includes(scope);
                                                    return (_jsx("button", { type: "button", onClick: () => toggleScope(scope), className: cn("rounded-sm border px-2.5 py-1 font-mono text-xs transition-all", active
                                                            ? SCOPE_COLORS[scope]
                                                            : "border-border text-muted-foreground hover:border-zinc-600 hover:text-foreground"), children: scope }, scope));
                                                }) })] }), _jsxs("div", { className: "space-y-1.5", children: [_jsx(Label, { children: "Ge\u00E7erlilik S\u00FCresi" }), _jsxs(Select, { value: formExpiry, onValueChange: setFormExpiry, children: [_jsx(SelectTrigger, { className: "text-xs", children: _jsx(SelectValue, {}) }), _jsx(SelectContent, { children: EXPIRY_OPTIONS.map((opt) => (_jsx(SelectItem, { value: opt.value, className: "text-xs", children: opt.label }, opt.value))) })] })] }), formError && (_jsx("div", { className: "rounded border border-red-900/50 bg-red-950/30 px-3 py-2", children: _jsx("p", { className: "text-xs text-red-400", children: formError }) }))] })) }), !newToken && (_jsxs(SheetFooter, { className: "border-t border-border px-6 py-4", children: [_jsx(Button, { variant: "ghost", onClick: () => setDrawerOpen(false), children: "\u0130ptal" }), _jsx(Button, { onClick: handleCreate, disabled: creating, children: creating ? (_jsxs(_Fragment, { children: [_jsx(Loader2, { className: "mr-2 h-3.5 w-3.5 animate-spin" }), "Olu\u015Fturuluyor\u2026"] })) : ("Token Oluştur") })] }))] }) })] }));
}
const LOCAL_TOKENS_KEY = "postgrify_local_tokens";
function addToLocalHistory(entry) {
    const existing = JSON.parse(localStorage.getItem(LOCAL_TOKENS_KEY) ?? "[]");
    existing.unshift({ ...entry, ts: Date.now() });
    localStorage.setItem(LOCAL_TOKENS_KEY, JSON.stringify(existing.slice(0, 20)));
}
function TokenHistory() {
    const [tokens, setTokens] = React.useState([]);
    React.useEffect(() => {
        const raw = localStorage.getItem(LOCAL_TOKENS_KEY);
        if (raw)
            setTokens(JSON.parse(raw));
    }, []);
    if (tokens.length === 0)
        return null;
    function remove(idx) {
        const updated = tokens.filter((_, i) => i !== idx);
        setTokens(updated);
        localStorage.setItem(LOCAL_TOKENS_KEY, JSON.stringify(updated));
    }
    return (_jsxs("div", { className: "rounded border border-border", children: [_jsxs("div", { className: "border-b border-border px-4 py-2.5", children: [_jsx("span", { className: "text-xs font-medium text-foreground", children: "Olu\u015Fturulan Token'lar" }), _jsx("span", { className: "ml-2 text-2xs text-muted-foreground", children: "(bu cihazda kay\u0131tl\u0131)" })] }), _jsx("div", { className: "divide-y divide-border/40", children: tokens.map((entry, i) => (_jsxs("div", { className: "group flex items-center gap-3 px-4 py-3", children: [_jsxs("div", { className: "flex-1 min-w-0", children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsx("span", { className: "font-mono text-sm text-foreground", children: entry.db }), _jsx("div", { className: "flex gap-1", children: entry.scopes.map((s) => (_jsx("span", { className: cn("inline-flex items-center rounded-sm border px-1 py-0.5 font-mono text-2xs", SCOPE_COLORS[s] ?? "border-border text-muted-foreground"), children: s }, s))) })] }), _jsxs("div", { className: "mt-0.5 flex items-center gap-2", children: [_jsx("code", { className: "max-w-[240px] truncate font-mono text-2xs text-muted-foreground", children: entry.token }), _jsx("span", { className: "text-2xs text-muted-foreground/40", children: entry.expiry })] })] }), _jsxs("div", { className: "flex items-center gap-1", children: [_jsx(CopyButton, { value: entry.token }), _jsx("button", { onClick: () => remove(i), className: "rounded p-1 text-muted-foreground/30 opacity-0 transition-all group-hover:opacity-100 hover:text-red-400", children: "\u00D7" })] })] }, i))) })] }));
}
