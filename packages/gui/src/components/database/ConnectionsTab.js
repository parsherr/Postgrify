import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
/**
 * ConnectionsTab — Per-database IP erişim kontrolü.
 *
 * Üç mod:
 *   everyone     — Herkese açık (varsayılan)
 *   same_network — Sunucuyla aynı ağdaki cihazlar (/24 subnet)
 *   allowlist    — Sadece belirtilen IP/CIDR adresleri
 *
 * URL: /databases/:db?tab=connections
 * Tasarım: OptionsTab ile aynı stil (max-w-lg, bg-card kartlar, text-xs içerik)
 */
import { useState, useEffect } from "react";
import { Shield, Globe, Network, Lock, Plus, X, Loader2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/Toast";
import { cn } from "@/lib/utils";
import { useIpAllowlist, useSetIpAllowlist, useResetIpAllowlist } from "../../hooks/useIpAllowlist.js";
// ── IP format validasyonu ──────────────────────────────────────────────────────
const IPV4_RE = /^(\d{1,3}\.){3}\d{1,3}$/;
const IPV4C_RE = /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/;
const IPV6_RE = /^[0-9a-fA-F:]+$/;
const IPV6C_RE = /^[0-9a-fA-F:]+\/\d{1,3}$/;
function isValidIpOrCidr(value) {
    const v = value.trim();
    return IPV4_RE.test(v) || IPV4C_RE.test(v) || IPV6_RE.test(v) || IPV6C_RE.test(v);
}
// ── Mod açıklamaları ──────────────────────────────────────────────────────────
const MODES = [
    {
        id: "everyone",
        label: "Herkese Açık",
        desc: "Tüm IP adreslerinden erişime izin verilir.",
        Icon: Globe,
    },
    {
        id: "same_network",
        label: "Aynı Ağ",
        desc: "Sunucuyla aynı yerel ağdaki (/24 subnet) cihazlar erişebilir.",
        Icon: Network,
    },
    {
        id: "allowlist",
        label: "IP Listesi",
        desc: "Yalnızca belirtilen IP adresleri veya CIDR blokları erişebilir.",
        Icon: Lock,
    },
];
// ── Ana bileşen ───────────────────────────────────────────────────────────────
export function ConnectionsTab({ db }) {
    const { data, isLoading, error } = useIpAllowlist(db);
    const { mutateAsync: saveAllowlist, isPending: saving } = useSetIpAllowlist(db);
    const { mutateAsync: resetAllowlist, isPending: resetting } = useResetIpAllowlist(db);
    const { success: toastSuccess, error: toastError } = useToast();
    const [mode, setMode] = useState("everyone");
    const [ips, setIps] = useState([]);
    const [input, setInput] = useState("");
    const [dirty, setDirty] = useState(false);
    // Sunucudan gelen veriyi yükle
    useEffect(() => {
        if (!data)
            return;
        setMode(data.mode ?? "everyone");
        setIps(data.ips ?? []);
        setDirty(false);
    }, [data]);
    function handleModeChange(next) {
        setMode(next);
        setDirty(true);
    }
    function addIp() {
        const val = input.trim();
        if (!val)
            return;
        if (!isValidIpOrCidr(val)) {
            toastError("Geçersiz format: IPv4, IPv6 veya CIDR giriniz.");
            return;
        }
        if (ips.includes(val)) {
            toastError(`${val} zaten listede var.`);
            return;
        }
        setIps((prev) => [...prev, val]);
        setInput("");
        setDirty(true);
    }
    function removeIp(ip) {
        setIps((prev) => prev.filter((x) => x !== ip));
        setDirty(true);
    }
    async function handleSave() {
        if (mode === "allowlist" && ips.length === 0) {
            toastError("IP listesi boş — en az bir IP veya CIDR ekleyiniz.");
            return;
        }
        const config = { mode, ips: mode === "allowlist" ? ips : [] };
        await saveAllowlist(config);
        setDirty(false);
        toastSuccess("Erişim ayarları güncellendi.");
    }
    async function handleReset() {
        await resetAllowlist();
        setMode("everyone");
        setIps([]);
        setDirty(false);
        toastSuccess("Erişim ayarları varsayılana döndürüldü.");
    }
    function handleDiscard() {
        if (!data)
            return;
        setMode(data.mode ?? "everyone");
        setIps(data.ips ?? []);
        setInput("");
        setDirty(false);
    }
    // ── Render ────────────────────────────────────────────────────────────────
    if (isLoading) {
        return (_jsx("div", { className: "flex h-full items-center justify-center", children: _jsx(Loader2, { className: "h-5 w-5 animate-spin text-muted-foreground" }) }));
    }
    if (error) {
        return (_jsx("div", { className: "h-full overflow-y-auto p-6", children: _jsx("div", { className: "mx-auto max-w-lg", children: _jsx("div", { className: "rounded border border-red-900/40 bg-card p-4", children: _jsx("p", { className: "text-xs text-red-400", children: "Eri\u015Fim ayarlar\u0131 y\u00FCklenemedi." }) }) }) }));
    }
    return (_jsx("div", { className: "h-full overflow-y-auto p-6", children: _jsxs("div", { className: "mx-auto max-w-lg space-y-6", children: [_jsx("h2", { className: "text-sm font-semibold", children: "Ba\u011Flant\u0131 Eri\u015Fim Kontrol\u00FC" }), _jsxs("div", { className: "rounded border border-border bg-card p-4", children: [_jsx("p", { className: "mb-3 text-xs font-medium text-muted-foreground", children: "Eri\u015Fim Modu" }), _jsx("div", { className: "space-y-2", children: MODES.map(({ id, label, desc, Icon }) => (_jsxs("button", { type: "button", onClick: () => handleModeChange(id), className: cn("flex w-full items-start gap-3 rounded px-3 py-2.5 text-left transition-colors", mode === id
                                    ? "bg-primary/10 text-foreground"
                                    : "text-muted-foreground hover:bg-muted/40"), children: [_jsx(Icon, { className: cn("mt-0.5 h-4 w-4 shrink-0", mode === id ? "text-primary" : "text-muted-foreground") }), _jsxs("div", { className: "min-w-0 flex-1", children: [_jsx("p", { className: cn("text-xs font-medium", mode === id ? "text-foreground" : "text-muted-foreground"), children: label }), _jsx("p", { className: "mt-0.5 text-xs text-muted-foreground", children: desc })] }), _jsx("div", { className: cn("mt-1 h-3.5 w-3.5 shrink-0 rounded-full border", mode === id
                                            ? "border-primary bg-primary"
                                            : "border-border bg-transparent") })] }, id))) })] }), mode === "allowlist" && (_jsxs("div", { className: "rounded border border-border bg-card p-4", children: [_jsx("p", { className: "mb-3 text-xs font-medium text-muted-foreground", children: "\u0130zin Verilen IP / CIDR Listesi" }), _jsxs("div", { className: "mb-3 flex gap-2", children: [_jsx(Input, { value: input, onChange: (e) => setInput(e.target.value), onKeyDown: (e) => e.key === "Enter" && addIp(), placeholder: "192.168.1.0/24 veya 10.0.0.1", className: "h-8 flex-1 text-xs font-mono" }), _jsxs(Button, { size: "sm", variant: "outline", onClick: addIp, className: "h-8 gap-1.5 text-xs", children: [_jsx(Plus, { className: "h-3.5 w-3.5" }), "Ekle"] })] }), ips.length === 0 ? (_jsxs("div", { className: "flex items-center gap-2 rounded border border-dashed border-border/60 px-3 py-3", children: [_jsx(AlertTriangle, { className: "h-3.5 w-3.5 shrink-0 text-yellow-500" }), _jsx("p", { className: "text-xs text-muted-foreground", children: "Liste bo\u015F \u2014 kaydetmeden \u00F6nce en az bir IP ekleyin." })] })) : (_jsx("div", { className: "space-y-1", children: ips.map((ip, idx, arr) => (_jsxs("div", { className: cn("flex items-center justify-between py-1.5 text-xs", idx !== arr.length - 1 && "border-b border-border/40"), children: [_jsx("span", { className: "font-mono text-foreground", children: ip }), _jsx("button", { type: "button", onClick: () => removeIp(ip), className: "rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground", children: _jsx(X, { className: "h-3.5 w-3.5" }) })] }, ip))) }))] })), !dirty && data && (_jsxs("div", { className: "rounded border border-border bg-card p-4", children: [_jsx("p", { className: "mb-3 text-xs font-medium text-muted-foreground", children: "Mevcut Ayar" }), _jsxs("div", { className: "space-y-2 text-xs text-muted-foreground", children: [_jsxs("div", { className: "flex justify-between border-b border-border/40 pb-2", children: [_jsx("span", { children: "Mod" }), _jsx("span", { className: "font-mono text-foreground", children: data.mode })] }), _jsxs("div", { className: "flex justify-between", children: [_jsx("span", { children: "\u0130zin verilen kural say\u0131s\u0131" }), _jsx("span", { className: "font-mono text-foreground", children: data.ips?.length ?? 0 })] })] })] })), _jsx("div", { className: "flex gap-2", children: dirty ? (_jsxs(_Fragment, { children: [_jsxs(Button, { size: "sm", onClick: handleSave, disabled: saving, className: "gap-1.5 text-xs", children: [saving ? (_jsx(Loader2, { className: "h-3.5 w-3.5 animate-spin" })) : (_jsx(Shield, { className: "h-3.5 w-3.5" })), "Kaydet"] }), _jsx(Button, { size: "sm", variant: "outline", onClick: handleDiscard, disabled: saving, className: "text-xs", children: "\u0130ptal" })] })) : (_jsxs(Button, { size: "sm", variant: "outline", onClick: handleReset, disabled: resetting, className: "gap-1.5 text-xs", children: [resetting ? (_jsx(Loader2, { className: "h-3.5 w-3.5 animate-spin" })) : null, "Herkese A\u00E7"] })) })] }) }));
}
