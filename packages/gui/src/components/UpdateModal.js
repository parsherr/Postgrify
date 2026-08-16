import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * UpdateModal — yeni sürüm çıktığında giriş sonrası bir kez gösterilir.
 *
 * Görünüm koşulu: localStorage'daki "postgrify_seen_version" mevcut
 * VERSION'dan farklıysa modal açılır. "Got it" veya "View Changes" tıklayınca
 * versiyon kaydedilir, modal tekrar çıkmaz.
 */
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Sparkles, ArrowRight, X } from "lucide-react";
import { Dialog, DialogContent, } from "@/components/ui/dialog";
import { parseChangelog, latestEntry, SEEN_VERSION_KEY } from "@/lib/changelog";
import changelogRaw from "../../../../CHANGELOG.md?raw";
const VERSION = import.meta.env
    .VITE_APP_VERSION ?? "0.0.0";
const ENTRIES = parseChangelog(changelogRaw);
const LATEST = latestEntry(ENTRIES);
function shouldShow() {
    if (!LATEST)
        return false;
    const seen = localStorage.getItem(SEEN_VERSION_KEY);
    return seen !== VERSION;
}
function markSeen() {
    localStorage.setItem(SEEN_VERSION_KEY, VERSION);
}
export function UpdateModal({ onClose }) {
    const [open, setOpen] = useState(false);
    const navigate = useNavigate();
    useEffect(() => {
        if (shouldShow())
            setOpen(true);
    }, []);
    function handleClose() {
        markSeen();
        setOpen(false);
        onClose?.();
    }
    function handleViewChanges() {
        markSeen();
        setOpen(false);
        onClose?.();
        navigate("/changelog");
    }
    if (!LATEST)
        return null;
    // Son sürümün maddeleri — en fazla 5 madde göster
    const allItems = LATEST.sections.flatMap((s) => s.items).slice(0, 5);
    return (_jsx(Dialog, { open: open, onOpenChange: (v) => { if (!v)
            handleClose(); }, children: _jsxs(DialogContent, { className: "max-w-sm border border-zinc-800 bg-zinc-950 p-0 shadow-2xl [&>button]:hidden", children: [_jsx("button", { onClick: handleClose, className: "absolute right-3 top-3 rounded p-1 text-zinc-600 transition-colors hover:text-zinc-300", "aria-label": "Kapat", children: _jsx(X, { className: "h-4 w-4" }) }), _jsxs("div", { className: "flex flex-col gap-5 p-6", children: [_jsx("div", { className: "flex items-center gap-2", children: _jsxs("span", { className: "flex items-center gap-1.5 rounded-full border border-zinc-700 bg-zinc-900 px-2.5 py-0.5 text-xs font-medium text-zinc-300", children: [_jsx(Sparkles, { className: "h-3 w-3 text-amber-400" }), "New update"] }) }), _jsxs("div", { children: [_jsxs("p", { className: "font-mono text-3xl font-semibold tracking-tight text-white", children: ["v", LATEST.version] }), _jsxs("p", { className: "mt-1 text-sm text-zinc-400", children: [LATEST.date, " \u00B7 What's new"] })] }), allItems.length > 0 && (_jsx("ul", { className: "space-y-2", children: allItems.map((item, i) => (_jsxs("li", { className: "flex items-start gap-2 text-sm text-zinc-300", children: [_jsx("span", { className: "mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-zinc-500" }), _jsx("span", { className: "leading-snug", children: item })] }, i))) })), _jsxs("div", { className: "flex items-center gap-2 pt-1", children: [_jsx("button", { onClick: handleViewChanges, className: "flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-medium text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-white", children: "View changelog" }), _jsxs("button", { onClick: handleClose, className: "flex items-center gap-1.5 rounded-lg bg-white px-4 py-2 text-sm font-medium text-black transition-colors hover:bg-zinc-100", children: ["Got it", _jsx(ArrowRight, { className: "h-3.5 w-3.5" })] })] })] })] }) }));
}
