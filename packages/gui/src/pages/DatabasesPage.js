import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * DatabasesPage — Managed database'lerin listesi.
 *
 * Veritabanı oluşturulduğunda API key tek seferlik bir modal'da gösterilir.
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { Database as DatabaseIcon, Plus, Trash2, Loader2, ChevronRight, Copy, Check, KeyRound, Eye, EyeOff, } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, } from "@/components/ui/dialog";
import { formatBytes, cn } from "@/lib/utils";
import { useDatabases, useCreateDatabase, useDeleteDatabase, } from "@/hooks/useDatabases";
// ── Yardımcı: kopyalama butonu ───────────────────────────────────────────────
function CopyButton({ text, className }) {
    const [copied, setCopied] = useState(false);
    const handleCopy = async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };
    return (_jsxs("button", { onClick: handleCopy, className: cn("inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs transition-colors", "bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground", className), children: [copied ? (_jsx(Check, { className: "h-3.5 w-3.5 text-green-500" })) : (_jsx(Copy, { className: "h-3.5 w-3.5" })), copied ? "Kopyalandı" : "Kopyala"] }));
}
function ApiKeyModal({ dbName, apiKey, onClose }) {
    const [revealed, setRevealed] = useState(false);
    return (_jsx(Dialog, { open: true, onOpenChange: () => onClose(), children: _jsxs(DialogContent, { className: "max-w-lg", children: [_jsxs(DialogHeader, { children: [_jsxs(DialogTitle, { className: "flex items-center gap-2", children: [_jsx(KeyRound, { className: "h-5 w-5 text-amber-500" }), "API Key olu\u015Fturuldu"] }), _jsxs(DialogDescription, { children: [_jsx("strong", { children: dbName }), " veritaban\u0131 i\u00E7in API key a\u015Fa\u011F\u0131da g\u00F6sterilmektedir. Bu key bir daha tam olarak g\u00F6sterilmeyecektir \u2014 \u015Fimdi kopyalay\u0131n."] })] }), _jsxs("div", { className: "rounded-lg border bg-muted/40 p-4 space-y-3", children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsx("code", { className: "flex-1 break-all text-sm font-mono text-foreground select-all", children: revealed ? apiKey : "•".repeat(Math.min(apiKey.length, 48)) }), _jsx("button", { onClick: () => setRevealed((v) => !v), className: "shrink-0 rounded p-1 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors", title: revealed ? "Gizle" : "Göster", children: revealed ? (_jsx(EyeOff, { className: "h-4 w-4" })) : (_jsx(Eye, { className: "h-4 w-4" })) })] }), _jsx("div", { className: "flex justify-end", children: _jsx(CopyButton, { text: apiKey }) })] }), _jsxs("div", { className: "rounded-md border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30 p-3 text-sm text-amber-800 dark:text-amber-300 space-y-1.5", children: [_jsx("p", { className: "font-medium", children: "SDK Kullan\u0131m\u0131" }), _jsx("pre", { className: "text-xs whitespace-pre-wrap break-all font-mono", children: `import { createClient } from '@postgrify/auth-js'

const auth = createClient({
  url: 'http://localhost:3000',
  database: '${dbName}',
  apiKey: '${revealed ? apiKey : "<api_key>"}',
})` })] }), _jsx(DialogFooter, { children: _jsx(Button, { onClick: onClose, children: "Anlad\u0131m, kapatt\u0131m" }) })] }) }));
}
// ── Ana sayfa ────────────────────────────────────────────────────────────────
export default function DatabasesPage() {
    const { data, isLoading } = useDatabases();
    const createDb = useCreateDatabase();
    const deleteDb = useDeleteDatabase();
    const [newDbName, setNewDbName] = useState("");
    const [confirmDelete, setConfirmDelete] = useState(null);
    const [createdApiKey, setCreatedApiKey] = useState(null);
    const databases = Array.isArray(data) ? data : [];
    const handleCreate = (e) => {
        e.preventDefault();
        if (!newDbName.trim())
            return;
        createDb.mutate(newDbName.trim(), {
            onSuccess: (result) => {
                if (result.api_key) {
                    setCreatedApiKey({ dbName: result.name, key: result.api_key });
                }
                setNewDbName("");
            },
        });
    };
    return (_jsxs("div", { className: "p-6 max-w-4xl mx-auto space-y-6", children: [_jsxs("div", { children: [_jsx("h1", { className: "text-2xl font-semibold tracking-tight", children: "Veritabanlar\u0131" }), _jsx("p", { className: "text-sm text-muted-foreground mt-1", children: "Her veritaban\u0131 izole bir PostgreSQL \u015Femas\u0131 ve auth sistemine sahiptir." })] }), _jsxs("form", { onSubmit: handleCreate, className: "flex gap-2 items-center", children: [_jsx(Input, { value: newDbName, onChange: (e) => setNewDbName(e.target.value), placeholder: "Veritaban\u0131 ad\u0131 (\u00F6rn: myapp)", className: "max-w-xs font-mono", pattern: "[a-zA-Z_][a-zA-Z0-9_]*", title: "Harf/alt \u00E7izgi ile ba\u015Flamal\u0131, yaln\u0131zca harf/rakam/alt \u00E7izgi i\u00E7erebilir" }), _jsxs(Button, { type: "submit", disabled: createDb.isPending || !newDbName.trim(), children: [createDb.isPending ? (_jsx(Loader2, { className: "h-4 w-4 animate-spin" })) : (_jsx(Plus, { className: "h-4 w-4" })), "Olu\u015Ftur"] })] }), createDb.isError && (_jsx("p", { className: "text-sm text-destructive", children: createDb.error?.message ?? "Veritabanı oluşturulamadı" })), isLoading ? (_jsxs("div", { className: "flex items-center gap-2 text-muted-foreground text-sm py-8", children: [_jsx(Loader2, { className: "h-4 w-4 animate-spin" }), "Y\u00FCkleniyor\u2026"] })) : databases.length === 0 ? (_jsxs("div", { className: "rounded-lg border border-dashed p-10 text-center text-muted-foreground", children: [_jsx(DatabaseIcon, { className: "h-8 w-8 mx-auto mb-3 opacity-40" }), _jsx("p", { className: "text-sm", children: "Hen\u00FCz veritaban\u0131 yok." })] })) : (_jsx("div", { className: "divide-y rounded-lg border", children: databases.map((db) => (_jsxs("div", { className: "flex items-center justify-between px-4 py-3 hover:bg-muted/30 transition-colors group", children: [_jsxs("div", { className: "flex items-center gap-3 min-w-0", children: [_jsx(DatabaseIcon, { className: "h-4 w-4 text-muted-foreground shrink-0" }), _jsx(Link, { to: `/databases/${db.name}`, className: "font-medium text-sm hover:underline truncate", children: db.name })] }), _jsxs("div", { className: "flex items-center gap-4 text-xs text-muted-foreground", children: [_jsx("span", { children: formatBytes(db.size_bytes) }), _jsxs("span", { children: [db.table_count, " tablo"] }), _jsx("button", { onClick: () => setConfirmDelete(db.name), className: "opacity-0 group-hover:opacity-100 transition-opacity text-destructive hover:text-destructive/80", title: "Sil", children: _jsx(Trash2, { className: "h-3.5 w-3.5" }) }), _jsx(Link, { to: `/databases/${db.name}`, children: _jsx(ChevronRight, { className: "h-4 w-4" }) })] })] }, db.name))) })), confirmDelete && (_jsx(Dialog, { open: true, onOpenChange: () => setConfirmDelete(null), children: _jsxs(DialogContent, { children: [_jsxs(DialogHeader, { children: [_jsx(DialogTitle, { children: "Veritaban\u0131n\u0131 sil" }), _jsxs(DialogDescription, { children: [_jsx("strong", { children: confirmDelete }), " veritaban\u0131 kal\u0131c\u0131 olarak silinecek. Bu i\u015Flem geri al\u0131namaz."] })] }), _jsxs(DialogFooter, { children: [_jsx(Button, { variant: "outline", onClick: () => setConfirmDelete(null), children: "\u0130ptal" }), _jsxs(Button, { variant: "destructive", disabled: deleteDb.isPending, onClick: () => deleteDb.mutate(confirmDelete, {
                                        onSuccess: () => setConfirmDelete(null),
                                    }), children: [deleteDb.isPending ? (_jsx(Loader2, { className: "h-4 w-4 animate-spin" })) : (_jsx(Trash2, { className: "h-4 w-4" })), "Evet, sil"] })] })] }) })), createdApiKey && (_jsx(ApiKeyModal, { dbName: createdApiKey.dbName, apiKey: createdApiKey.key, onClose: () => setCreatedApiKey(null) }))] }));
}
