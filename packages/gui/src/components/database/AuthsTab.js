import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
/**
 * AuthsTab — per-database auth yönetim paneli.
 *
 * Alt sekmeler:
 *   1. Kullanıcılar  — kullanıcı listesi, davet, düzenle, sil
 *   2. Ayarlar       — feature flag'ler, OAuth provider'lar
 *   3. Audit Log     — tüm auth eventlarının kaydı
 *   4. Session'lar   — aktif session listesi, zorla çıkart
 */
import { useState } from "react";
import { UserPlus, Pencil, Trash2, KeyRound, ShieldCheck, Eye, FilePen, CircleSlash, Loader2, RefreshCw, Settings, ClipboardList, LogOut, Plus, Check, X, ChevronLeft, ChevronRight, Github, } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, } from "@/components/ui/select";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import { useDbAuthUsers, useCreateDbAuthUser, useUpdateDbAuthUser, useDeleteDbAuthUser, useResetDbAuthUserPassword, } from "@/hooks/useDbAuth";
import { useAuthSettings, useUpdateAuthSettings, useOAuthProviders, useUpsertOAuthProvider, useDeleteOAuthProvider } from "@/hooks/useAuthSettings";
import { useAuditLog } from "@/hooks/useAuditLog";
import { useAuthSessions, useRevokeAuthSession } from "@/hooks/useAuthSessions";
import { cn } from "@/lib/utils";
// ── Tip yardımcıları ─────────────────────────────────────────────────────────
const ROLE_META = {
    admin: { label: "Admin", icon: ShieldCheck, color: "text-rose-500" },
    editor: { label: "Editor", icon: FilePen, color: "text-amber-500" },
    viewer: { label: "Viewer", icon: Eye, color: "text-sky-500" },
};
function RoleBadge({ role }) {
    const meta = ROLE_META[role] ?? ROLE_META.viewer;
    const Icon = meta.icon;
    return (_jsxs("span", { className: cn("inline-flex items-center gap-1 text-xs font-medium", meta.color), children: [_jsx(Icon, { className: "h-3 w-3" }), meta.label] }));
}
function formatDate(iso) {
    if (!iso)
        return "—";
    return new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
}
function InviteUserDialog({ db, open, onClose }) {
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [role, setRole] = useState("viewer");
    const { mutateAsync, isPending } = useCreateDbAuthUser(db);
    const toast = useToast();
    async function handleSubmit(e) {
        e.preventDefault();
        try {
            await mutateAsync({ email, password, role });
            toast.success(`${email} başarıyla eklendi.`);
            setEmail("");
            setPassword("");
            setRole("viewer");
            onClose();
        }
        catch (err) {
            toast.error(err instanceof Error ? err.message : "Kullanıcı oluşturulamadı.");
        }
    }
    return (_jsx(Dialog, { open: open, onOpenChange: (v) => !v && onClose(), children: _jsxs(DialogContent, { className: "sm:max-w-md", children: [_jsx(DialogHeader, { children: _jsxs(DialogTitle, { className: "flex items-center gap-2", children: [_jsx(UserPlus, { className: "h-4 w-4" }), "Kullan\u0131c\u0131 Davet Et"] }) }), _jsxs("form", { onSubmit: handleSubmit, className: "space-y-4 pt-2", children: [_jsxs("div", { className: "space-y-1.5", children: [_jsx(Label, { htmlFor: "invite-email", children: "E-posta" }), _jsx(Input, { id: "invite-email", type: "email", placeholder: "kullanici@example.com", value: email, onChange: (e) => setEmail(e.target.value), required: true, autoFocus: true })] }), _jsxs("div", { className: "space-y-1.5", children: [_jsx(Label, { htmlFor: "invite-password", children: "Ba\u015Flang\u0131\u00E7 \u015Eifresi" }), _jsx(Input, { id: "invite-password", type: "password", placeholder: "En az 8 karakter", value: password, onChange: (e) => setPassword(e.target.value), minLength: 8, required: true })] }), _jsxs("div", { className: "space-y-1.5", children: [_jsx(Label, { htmlFor: "invite-role", children: "Rol" }), _jsxs(Select, { value: role, onValueChange: (v) => setRole(v), children: [_jsx(SelectTrigger, { id: "invite-role", children: _jsx(SelectValue, {}) }), _jsxs(SelectContent, { children: [_jsx(SelectItem, { value: "viewer", children: "Viewer \u2014 Sadece okuma" }), _jsx(SelectItem, { value: "editor", children: "Editor \u2014 Okuma + yazma" }), _jsx(SelectItem, { value: "admin", children: "Admin \u2014 Tam eri\u015Fim" })] })] })] }), _jsxs(DialogFooter, { className: "pt-2", children: [_jsx(Button, { type: "button", variant: "ghost", onClick: onClose, disabled: isPending, children: "\u0130ptal" }), _jsxs(Button, { type: "submit", disabled: isPending, children: [isPending && _jsx(Loader2, { className: "mr-2 h-4 w-4 animate-spin" }), "Ekle"] })] })] })] }) }));
}
function EditUserDialog({ db, user, open, onClose }) {
    const [role, setRole] = useState(user.role);
    const [isActive, setIsActive] = useState(user.is_active);
    const { mutateAsync, isPending } = useUpdateDbAuthUser(db);
    const toast = useToast();
    async function handleSubmit(e) {
        e.preventDefault();
        try {
            await mutateAsync({ id: user.id, role, is_active: isActive });
            toast.success("Kullanıcı güncellendi.");
            onClose();
        }
        catch (err) {
            toast.error(err instanceof Error ? err.message : "Güncellenemedi.");
        }
    }
    return (_jsx(Dialog, { open: open, onOpenChange: (v) => !v && onClose(), children: _jsxs(DialogContent, { className: "sm:max-w-md", children: [_jsx(DialogHeader, { children: _jsxs(DialogTitle, { className: "flex items-center gap-2", children: [_jsx(Pencil, { className: "h-4 w-4" }), "Kullan\u0131c\u0131y\u0131 D\u00FCzenle"] }) }), _jsxs("form", { onSubmit: handleSubmit, className: "space-y-4 pt-2", children: [_jsx("p", { className: "text-sm text-muted-foreground", children: user.email }), _jsxs("div", { className: "space-y-1.5", children: [_jsx(Label, { children: "Rol" }), _jsxs(Select, { value: role, onValueChange: (v) => setRole(v), children: [_jsx(SelectTrigger, { children: _jsx(SelectValue, {}) }), _jsxs(SelectContent, { children: [_jsx(SelectItem, { value: "viewer", children: "Viewer" }), _jsx(SelectItem, { value: "editor", children: "Editor" }), _jsx(SelectItem, { value: "admin", children: "Admin" })] })] })] }), _jsxs("div", { className: "flex items-center gap-3", children: [_jsx("input", { type: "checkbox", id: "is-active", checked: isActive, onChange: (e) => setIsActive(e.target.checked), className: "h-4 w-4 rounded border-border" }), _jsx(Label, { htmlFor: "is-active", children: "Hesap aktif" })] }), _jsxs(DialogFooter, { className: "pt-2", children: [_jsx(Button, { type: "button", variant: "ghost", onClick: onClose, disabled: isPending, children: "\u0130ptal" }), _jsxs(Button, { type: "submit", disabled: isPending, children: [isPending && _jsx(Loader2, { className: "mr-2 h-4 w-4 animate-spin" }), "Kaydet"] })] })] })] }) }));
}
function ResetPasswordDialog({ db, user, open, onClose }) {
    const [password, setPassword] = useState("");
    const { mutateAsync, isPending } = useResetDbAuthUserPassword(db);
    const toast = useToast();
    async function handleSubmit(e) {
        e.preventDefault();
        try {
            await mutateAsync({ id: user.id, password });
            toast.success("Şifre güncellendi.");
            setPassword("");
            onClose();
        }
        catch (err) {
            toast.error(err instanceof Error ? err.message : "Şifre güncellenemedi.");
        }
    }
    return (_jsx(Dialog, { open: open, onOpenChange: (v) => !v && onClose(), children: _jsxs(DialogContent, { className: "sm:max-w-md", children: [_jsx(DialogHeader, { children: _jsxs(DialogTitle, { className: "flex items-center gap-2", children: [_jsx(KeyRound, { className: "h-4 w-4" }), "\u015Eifre S\u0131f\u0131rla"] }) }), _jsxs("form", { onSubmit: handleSubmit, className: "space-y-4 pt-2", children: [_jsx("p", { className: "text-sm text-muted-foreground", children: user.email }), _jsxs("div", { className: "space-y-1.5", children: [_jsx(Label, { htmlFor: "new-password", children: "Yeni \u015Eifre" }), _jsx(Input, { id: "new-password", type: "password", placeholder: "En az 8 karakter", value: password, onChange: (e) => setPassword(e.target.value), minLength: 8, required: true, autoFocus: true })] }), _jsxs(DialogFooter, { className: "pt-2", children: [_jsx(Button, { type: "button", variant: "ghost", onClick: onClose, disabled: isPending, children: "\u0130ptal" }), _jsxs(Button, { type: "submit", disabled: isPending, children: [isPending && _jsx(Loader2, { className: "mr-2 h-4 w-4 animate-spin" }), "S\u0131f\u0131rla"] })] })] })] }) }));
}
function UsersSubTab({ db }) {
    const [search, setSearch] = useState("");
    const [inviteOpen, setInviteOpen] = useState(false);
    const [editUser, setEditUser] = useState(null);
    const [resetUser, setResetUser] = useState(null);
    const [deleteTarget, setDeleteTarget] = useState(null);
    const { data, isLoading, refetch } = useDbAuthUsers(db);
    const { mutateAsync: deleteUser } = useDeleteDbAuthUser(db);
    const toast = useToast();
    async function handleDelete(user) {
        try {
            await deleteUser(user.id);
            toast.success(`${user.email} silindi.`);
            setDeleteTarget(null);
        }
        catch (err) {
            toast.error(err instanceof Error ? err.message : "Silinemedi.");
        }
    }
    const filtered = (data?.users ?? []).filter((u) => u.email.toLowerCase().includes(search.toLowerCase()));
    return (_jsxs("div", { children: [_jsxs("div", { className: "flex items-center justify-between px-4 py-3 border-b border-border", children: [_jsx(Input, { placeholder: "Email ara...", value: search, onChange: (e) => setSearch(e.target.value), className: "h-8 w-64 text-xs" }), _jsxs("div", { className: "flex gap-2", children: [_jsx(Button, { variant: "ghost", size: "sm", onClick: () => refetch(), children: _jsx(RefreshCw, { className: cn("h-3.5 w-3.5", isLoading && "animate-spin") }) }), _jsxs(Button, { size: "sm", onClick: () => setInviteOpen(true), children: [_jsx(UserPlus, { className: "mr-1.5 h-3.5 w-3.5" }), "Davet Et"] })] })] }), isLoading ? (_jsx("div", { className: "flex items-center justify-center py-12", children: _jsx(Loader2, { className: "h-5 w-5 animate-spin text-muted-foreground" }) })) : filtered.length === 0 ? (_jsx("div", { className: "py-12 text-center text-sm text-muted-foreground", children: search ? "Eşleşen kullanıcı yok." : "Henüz kullanıcı yok." })) : (_jsxs("div", { className: "overflow-x-auto", children: [_jsxs("table", { className: "w-full text-sm", children: [_jsx("thead", { children: _jsxs("tr", { className: "border-b border-border bg-muted/30 text-xs text-muted-foreground", children: [_jsx("th", { className: "px-4 py-2 text-left font-medium", children: "Email" }), _jsx("th", { className: "px-4 py-2 text-left font-medium", children: "Rol" }), _jsx("th", { className: "px-4 py-2 text-left font-medium", children: "Durum" }), _jsx("th", { className: "px-4 py-2 text-left font-medium", children: "Son Giri\u015F" }), _jsx("th", { className: "px-4 py-2 text-right font-medium", children: "\u0130\u015Flemler" })] }) }), _jsx("tbody", { className: "divide-y divide-border", children: filtered.map((user) => (_jsxs("tr", { className: "hover:bg-muted/20 transition-colors", children: [_jsx("td", { className: "px-4 py-2.5 font-mono text-xs", children: user.email }), _jsx("td", { className: "px-4 py-2.5", children: _jsx(RoleBadge, { role: user.role }) }), _jsx("td", { className: "px-4 py-2.5", children: user.is_active ? (_jsx(Badge, { variant: "outline", className: "text-emerald-500 border-emerald-500/30 text-xs", children: "Aktif" })) : (_jsxs(Badge, { variant: "outline", className: "text-muted-foreground text-xs", children: [_jsx(CircleSlash, { className: "mr-1 h-3 w-3" }), "Devre D\u0131\u015F\u0131"] })) }), _jsx("td", { className: "px-4 py-2.5 text-xs text-muted-foreground", children: formatDate(user.last_login ?? null) }), _jsx("td", { className: "px-4 py-2.5", children: _jsxs("div", { className: "flex items-center justify-end gap-1", children: [_jsx(Button, { variant: "ghost", size: "icon", className: "h-7 w-7", title: "D\u00FCzenle", onClick: () => setEditUser(user), children: _jsx(Pencil, { className: "h-3.5 w-3.5" }) }), _jsx(Button, { variant: "ghost", size: "icon", className: "h-7 w-7", title: "\u015Eifre S\u0131f\u0131rla", onClick: () => setResetUser(user), children: _jsx(KeyRound, { className: "h-3.5 w-3.5" }) }), _jsx(Button, { variant: "ghost", size: "icon", className: "h-7 w-7 text-destructive hover:text-destructive", title: "Sil", onClick: () => setDeleteTarget(user), children: _jsx(Trash2, { className: "h-3.5 w-3.5" }) })] }) })] }, user.id))) })] }), _jsxs("div", { className: "px-4 py-2 border-t border-border bg-muted/20 text-xs text-muted-foreground", children: [data?.total ?? 0, " kullan\u0131c\u0131"] })] })), _jsx(InviteUserDialog, { db: db, open: inviteOpen, onClose: () => setInviteOpen(false) }), editUser && _jsx(EditUserDialog, { db: db, user: editUser, open: true, onClose: () => setEditUser(null) }), resetUser && _jsx(ResetPasswordDialog, { db: db, user: resetUser, open: true, onClose: () => setResetUser(null) }), deleteTarget && (_jsx(ConfirmDialog, { open: true, title: "Kullan\u0131c\u0131y\u0131 Sil", description: `"${deleteTarget.email}" kalıcı olarak silinecek.`, confirmLabel: "Sil", onConfirm: () => handleDelete(deleteTarget), onCancel: () => setDeleteTarget(null) }))] }));
}
// ── 2. Ayarlar ───────────────────────────────────────────────────────────────
function ToggleRow({ label, description, value, onChange, disabled, }) {
    return (_jsxs("div", { className: "flex items-center justify-between py-3 border-b border-border last:border-0", children: [_jsxs("div", { children: [_jsx("p", { className: "text-sm font-medium", children: label }), description && _jsx("p", { className: "text-xs text-muted-foreground mt-0.5", children: description })] }), _jsx("button", { type: "button", disabled: disabled, onClick: () => onChange(!value), className: cn("relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none", value ? "bg-primary" : "bg-muted", disabled && "opacity-50 cursor-not-allowed"), children: _jsx("span", { className: cn("pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition-transform", value ? "translate-x-4" : "translate-x-0") }) })] }));
}
function OAuthProviderRow({ db, provider, label, icon, }) {
    const { data: providers } = useOAuthProviders(db);
    const existing = providers?.find((p) => p.provider === provider);
    const { mutateAsync: upsert, isPending: upserting } = useUpsertOAuthProvider(db);
    const { mutateAsync: remove, isPending: removing } = useDeleteOAuthProvider(db);
    const toast = useToast();
    const [open, setOpen] = useState(false);
    const [clientId, setClientId] = useState("");
    const [clientSecret, setClientSecret] = useState("");
    const [redirectUri, setRedirectUri] = useState("");
    function openDialog() {
        if (existing) {
            setClientId(existing.client_id);
            setRedirectUri(existing.redirect_uri);
            setClientSecret("");
        }
        setOpen(true);
    }
    async function handleSave(e) {
        e.preventDefault();
        try {
            await upsert({ provider, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri });
            toast.success(`${label} yapılandırması kaydedildi.`);
            setOpen(false);
        }
        catch (err) {
            toast.error(err instanceof Error ? err.message : "Kaydedilemedi.");
        }
    }
    async function handleRemove() {
        try {
            await remove(provider);
            toast.success(`${label} kaldırıldı.`);
        }
        catch (err) {
            toast.error(err instanceof Error ? err.message : "Kaldırılamadı.");
        }
    }
    return (_jsxs(_Fragment, { children: [_jsxs("div", { className: "flex items-center justify-between py-3 border-b border-border last:border-0", children: [_jsxs("div", { className: "flex items-center gap-3", children: [_jsx("div", { className: "h-8 w-8 flex items-center justify-center rounded-md bg-muted", children: icon }), _jsxs("div", { children: [_jsx("p", { className: "text-sm font-medium", children: label }), existing ? (_jsxs("p", { className: "text-xs text-emerald-500 flex items-center gap-1", children: [_jsx(Check, { className: "h-3 w-3" }), "Yap\u0131land\u0131r\u0131ld\u0131"] })) : (_jsx("p", { className: "text-xs text-muted-foreground", children: "Yap\u0131land\u0131r\u0131lmad\u0131" }))] })] }), _jsxs("div", { className: "flex gap-2", children: [_jsx(Button, { variant: "outline", size: "sm", onClick: openDialog, children: existing ? _jsxs(_Fragment, { children: [_jsx(Pencil, { className: "mr-1.5 h-3 w-3" }), "D\u00FCzenle"] }) : _jsxs(_Fragment, { children: [_jsx(Plus, { className: "mr-1.5 h-3 w-3" }), "Ekle"] }) }), existing && (_jsx(Button, { variant: "ghost", size: "sm", className: "text-destructive hover:text-destructive", onClick: handleRemove, disabled: removing, children: _jsx(X, { className: "h-3.5 w-3.5" }) }))] })] }), _jsx(Dialog, { open: open, onOpenChange: (v) => !v && setOpen(false), children: _jsxs(DialogContent, { className: "sm:max-w-md", children: [_jsx(DialogHeader, { children: _jsxs(DialogTitle, { children: [label, " OAuth Yap\u0131land\u0131rmas\u0131"] }) }), _jsxs("form", { onSubmit: handleSave, className: "space-y-4 pt-2", children: [_jsxs("div", { className: "space-y-1.5", children: [_jsx(Label, { children: "Client ID" }), _jsx(Input, { value: clientId, onChange: (e) => setClientId(e.target.value), required: true, placeholder: `${label} Client ID` })] }), _jsxs("div", { className: "space-y-1.5", children: [_jsx(Label, { children: "Client Secret" }), _jsx(Input, { type: "password", value: clientSecret, onChange: (e) => setClientSecret(e.target.value), required: !existing, placeholder: existing ? "Değiştirmek için girin" : `${label} Client Secret` })] }), _jsxs("div", { className: "space-y-1.5", children: [_jsx(Label, { children: "Redirect URI" }), _jsx(Input, { value: redirectUri, onChange: (e) => setRedirectUri(e.target.value), required: true, placeholder: "https://yourapp.com/auth/callback" })] }), _jsxs(DialogFooter, { children: [_jsx(Button, { type: "button", variant: "ghost", onClick: () => setOpen(false), children: "\u0130ptal" }), _jsxs(Button, { type: "submit", disabled: upserting, children: [upserting && _jsx(Loader2, { className: "mr-2 h-4 w-4 animate-spin" }), "Kaydet"] })] })] })] }) })] }));
}
function SettingsSubTab({ db }) {
    const { data: settings, isLoading } = useAuthSettings(db);
    const { mutateAsync: update, isPending } = useUpdateAuthSettings(db);
    const toast = useToast();
    async function toggle(key, current) {
        const next = current === "true" ? "false" : "true";
        try {
            await update({ [key]: next });
        }
        catch {
            toast.error("Ayar güncellenemedi.");
        }
    }
    if (isLoading) {
        return _jsx("div", { className: "flex items-center justify-center py-12", children: _jsx(Loader2, { className: "h-5 w-5 animate-spin text-muted-foreground" }) });
    }
    const s = settings ?? {};
    return (_jsxs("div", { className: "p-4 space-y-6 max-w-2xl", children: [_jsxs("div", { children: [_jsx("h3", { className: "text-sm font-semibold mb-3", children: "Giri\u015F Y\u00F6ntemleri" }), _jsxs("div", { className: "rounded-lg border border-border px-4", children: [_jsx(ToggleRow, { label: "Email + \u015Eifre Kayd\u0131", description: "Yeni kullan\u0131c\u0131lar email+\u015Fifre ile kay\u0131t olabilir.", value: s.email_signup_enabled === "true", onChange: () => toggle("email_signup_enabled", s.email_signup_enabled ?? "true"), disabled: isPending }), _jsx(ToggleRow, { label: "Email Do\u011Frulama Zorunlu", description: "Kay\u0131t sonras\u0131 email do\u011Frulanana kadar giri\u015F yap\u0131lamaz.", value: s.email_verify_required === "true", onChange: () => toggle("email_verify_required", s.email_verify_required ?? "false"), disabled: isPending }), _jsx(ToggleRow, { label: "Magic Link (\u015Eifresiz Giri\u015F)", description: "Kullan\u0131c\u0131lar email'e gelen tek t\u0131kla giri\u015F linkiyle oturum a\u00E7abilir.", value: s.magic_link_enabled === "true", onChange: () => toggle("magic_link_enabled", s.magic_link_enabled ?? "false"), disabled: isPending })] })] }), _jsxs("div", { children: [_jsx("h3", { className: "text-sm font-semibold mb-3", children: "OAuth Sa\u011Flay\u0131c\u0131lar\u0131" }), _jsxs("div", { className: "rounded-lg border border-border px-4", children: [_jsx(OAuthProviderRow, { db: db, provider: "google", label: "Google", icon: _jsxs("svg", { viewBox: "0 0 24 24", className: "h-4 w-4", children: [_jsx("path", { d: "M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z", fill: "#4285F4" }), _jsx("path", { d: "M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z", fill: "#34A853" }), _jsx("path", { d: "M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z", fill: "#FBBC05" }), _jsx("path", { d: "M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z", fill: "#EA4335" })] }) }), _jsx(OAuthProviderRow, { db: db, provider: "github", label: "GitHub", icon: _jsx(Github, { className: "h-4 w-4" }) })] })] })] }));
}
// ── 3. Audit Log ─────────────────────────────────────────────────────────────
const EVENT_COLORS = {
    login: "text-emerald-500",
    logout: "text-muted-foreground",
    signup: "text-sky-500",
    login_failed: "text-rose-500",
    password_reset: "text-amber-500",
    password_reset_request: "text-amber-400",
    magic_link_login: "text-violet-500",
    magic_link_request: "text-violet-400",
    oauth_login: "text-blue-500",
    oauth_signup: "text-blue-400",
    email_verified: "text-emerald-400",
    account_disabled: "text-rose-400",
    password_changed: "text-amber-500",
};
function AuditLogSubTab({ db }) {
    const [offset, setOffset] = useState(0);
    const [eventFilter, setEventFilter] = useState("");
    const LIMIT = 50;
    const { data, isLoading, refetch } = useAuditLog(db, {
        limit: LIMIT, offset, event: eventFilter || undefined,
    });
    const total = data?.total ?? 0;
    const pages = Math.ceil(total / LIMIT);
    const current = Math.floor(offset / LIMIT) + 1;
    return (_jsxs("div", { children: [_jsxs("div", { className: "flex items-center justify-between px-4 py-3 border-b border-border", children: [_jsxs(Select, { value: eventFilter, onValueChange: (v) => { setEventFilter(v); setOffset(0); }, children: [_jsx(SelectTrigger, { className: "h-8 w-52 text-xs", children: _jsx(SelectValue, { placeholder: "T\u00FCm eventlar" }) }), _jsxs(SelectContent, { children: [_jsx(SelectItem, { value: "", children: "T\u00FCm eventlar" }), ["login", "logout", "signup", "login_failed", "password_reset", "password_reset_request",
                                        "magic_link_login", "magic_link_request", "oauth_login", "oauth_signup", "email_verified"].map((e) => (_jsx(SelectItem, { value: e, children: e }, e)))] })] }), _jsx(Button, { variant: "ghost", size: "sm", onClick: () => refetch(), children: _jsx(RefreshCw, { className: cn("h-3.5 w-3.5", isLoading && "animate-spin") }) })] }), isLoading ? (_jsx("div", { className: "flex items-center justify-center py-12", children: _jsx(Loader2, { className: "h-5 w-5 animate-spin text-muted-foreground" }) })) : !data?.data.length ? (_jsx("div", { className: "py-12 text-center text-sm text-muted-foreground", children: "Kay\u0131t yok." })) : (_jsxs(_Fragment, { children: [_jsx("div", { className: "overflow-x-auto", children: _jsxs("table", { className: "w-full text-xs", children: [_jsx("thead", { children: _jsxs("tr", { className: "border-b border-border bg-muted/30 text-muted-foreground", children: [_jsx("th", { className: "px-4 py-2 text-left font-medium", children: "Event" }), _jsx("th", { className: "px-4 py-2 text-left font-medium", children: "Kullan\u0131c\u0131" }), _jsx("th", { className: "px-4 py-2 text-left font-medium", children: "IP" }), _jsx("th", { className: "px-4 py-2 text-left font-medium", children: "Tarih" })] }) }), _jsx("tbody", { className: "divide-y divide-border", children: data.data.map((entry) => (_jsxs("tr", { className: "hover:bg-muted/20 transition-colors", children: [_jsx("td", { className: "px-4 py-2.5", children: _jsx("span", { className: cn("font-mono font-medium", EVENT_COLORS[entry.event] ?? "text-foreground"), children: entry.event }) }), _jsx("td", { className: "px-4 py-2.5 text-muted-foreground font-mono", children: entry.user_email ?? entry.user_id?.slice(0, 8) ?? "—" }), _jsx("td", { className: "px-4 py-2.5 text-muted-foreground", children: entry.ip ?? "—" }), _jsx("td", { className: "px-4 py-2.5 text-muted-foreground", children: formatDate(entry.created_at) })] }, entry.id))) })] }) }), _jsxs("div", { className: "flex items-center justify-between px-4 py-2 border-t border-border bg-muted/20 text-xs text-muted-foreground", children: [_jsxs("span", { children: [total, " kay\u0131t"] }), pages > 1 && (_jsxs("div", { className: "flex items-center gap-2", children: [_jsx(Button, { variant: "ghost", size: "icon", className: "h-6 w-6", disabled: current === 1, onClick: () => setOffset(offset - LIMIT), children: _jsx(ChevronLeft, { className: "h-3 w-3" }) }), _jsxs("span", { children: [current, " / ", pages] }), _jsx(Button, { variant: "ghost", size: "icon", className: "h-6 w-6", disabled: current === pages, onClick: () => setOffset(offset + LIMIT), children: _jsx(ChevronRight, { className: "h-3 w-3" }) })] }))] })] }))] }));
}
// ── 4. Session'lar ───────────────────────────────────────────────────────────
function SessionsSubTab({ db }) {
    const { data, isLoading, refetch } = useAuthSessions(db);
    const { mutateAsync: revoke } = useRevokeAuthSession(db);
    const toast = useToast();
    async function handleRevoke(id) {
        try {
            await revoke(id);
            toast.success("Session sonlandırıldı.");
        }
        catch {
            toast.error("Session sonlandırılamadı.");
        }
    }
    const active = (data?.data ?? []).filter((s) => !s.revoked && new Date(s.expires_at) > new Date());
    return (_jsxs("div", { children: [_jsxs("div", { className: "flex items-center justify-between px-4 py-3 border-b border-border", children: [_jsxs("span", { className: "text-xs text-muted-foreground", children: [active.length, " aktif session"] }), _jsx(Button, { variant: "ghost", size: "sm", onClick: () => refetch(), children: _jsx(RefreshCw, { className: cn("h-3.5 w-3.5", isLoading && "animate-spin") }) })] }), isLoading ? (_jsx("div", { className: "flex items-center justify-center py-12", children: _jsx(Loader2, { className: "h-5 w-5 animate-spin text-muted-foreground" }) })) : !active.length ? (_jsx("div", { className: "py-12 text-center text-sm text-muted-foreground", children: "Aktif session yok." })) : (_jsx("div", { className: "overflow-x-auto", children: _jsxs("table", { className: "w-full text-xs", children: [_jsx("thead", { children: _jsxs("tr", { className: "border-b border-border bg-muted/30 text-muted-foreground", children: [_jsx("th", { className: "px-4 py-2 text-left font-medium", children: "Kullan\u0131c\u0131" }), _jsx("th", { className: "px-4 py-2 text-left font-medium", children: "IP" }), _jsx("th", { className: "px-4 py-2 text-left font-medium", children: "Olu\u015Fturulma" }), _jsx("th", { className: "px-4 py-2 text-left font-medium", children: "Son Tarih" }), _jsx("th", { className: "px-4 py-2 text-right font-medium", children: "\u0130\u015Flem" })] }) }), _jsx("tbody", { className: "divide-y divide-border", children: active.map((session) => (_jsxs("tr", { className: "hover:bg-muted/20 transition-colors", children: [_jsx("td", { className: "px-4 py-2.5 font-mono", children: session.user_email ?? session.user_id.slice(0, 8) }), _jsx("td", { className: "px-4 py-2.5 text-muted-foreground", children: session.ip ?? "—" }), _jsx("td", { className: "px-4 py-2.5 text-muted-foreground", children: formatDate(session.created_at) }), _jsx("td", { className: "px-4 py-2.5 text-muted-foreground", children: formatDate(session.expires_at) }), _jsx("td", { className: "px-4 py-2.5 text-right", children: _jsx(Button, { variant: "ghost", size: "sm", className: "h-7 text-destructive hover:text-destructive", onClick: () => handleRevoke(session.id), title: "Session'\u0131 Sonland\u0131r", children: _jsx(LogOut, { className: "h-3.5 w-3.5" }) }) })] }, session.id))) })] }) }))] }));
}
const TABS = [
    { id: "users", label: "Kullanıcılar", icon: UserPlus },
    { id: "settings", label: "Ayarlar", icon: Settings },
    { id: "audit", label: "Audit Log", icon: ClipboardList },
    { id: "sessions", label: "Session'lar", icon: LogOut },
];
export function AuthsTab({ db }) {
    const [activeTab, setActiveTab] = useState("users");
    return (_jsxs("div", { className: "flex flex-col h-full", children: [_jsx("div", { className: "flex border-b border-border bg-muted/20 px-2", children: TABS.map(({ id, label, icon: Icon }) => (_jsxs("button", { onClick: () => setActiveTab(id), className: cn("flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium border-b-2 transition-colors", activeTab === id
                        ? "border-primary text-foreground"
                        : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"), children: [_jsx(Icon, { className: "h-3.5 w-3.5" }), label] }, id))) }), _jsxs("div", { className: "flex-1 overflow-auto", children: [activeTab === "users" && _jsx(UsersSubTab, { db: db }), activeTab === "settings" && _jsx(SettingsSubTab, { db: db }), activeTab === "audit" && _jsx(AuditLogSubTab, { db: db }), activeTab === "sessions" && _jsx(SessionsSubTab, { db: db })] })] }));
}
