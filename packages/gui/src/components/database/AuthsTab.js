import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * AuthsTab — per-database kullanıcı yönetimi.
 *
 * Özellikler:
 *   - Kullanıcı listesi (email, rol, durum, son giriş)
 *   - Kullanıcı davet et (InviteUserDialog)
 *   - Rol / durum düzenle (EditUserDialog)
 *   - Şifre sıfırla (ResetPasswordDialog)
 *   - Kullanıcı sil (ConfirmDialog)
 */
import { useState } from "react";
import { UserPlus, Pencil, Trash2, KeyRound, ShieldCheck, Eye, FilePen, CircleSlash, Loader2, RefreshCw, } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, } from "@/components/ui/select";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import { useDbAuthUsers, useCreateDbAuthUser, useUpdateDbAuthUser, useDeleteDbAuthUser, useResetDbAuthUserPassword, } from "@/hooks/useDbAuth";
import { cn } from "@/lib/utils";
// ── Yardımcı bileşenler ──────────────────────────────────────────────────────
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
    return new Intl.DateTimeFormat("tr-TR", {
        dateStyle: "medium",
        timeStyle: "short",
    }).format(new Date(iso));
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
    return (_jsx(Dialog, { open: open, onOpenChange: (v) => !v && onClose(), children: _jsxs(DialogContent, { className: "sm:max-w-md", children: [_jsx(DialogHeader, { children: _jsxs(DialogTitle, { className: "flex items-center gap-2", children: [_jsx(UserPlus, { className: "h-4 w-4" }), "Kullan\u0131c\u0131 Davet Et"] }) }), _jsxs("form", { onSubmit: handleSubmit, className: "space-y-4 pt-2", children: [_jsxs("div", { className: "space-y-1.5", children: [_jsx(Label, { htmlFor: "invite-email", children: "E-posta" }), _jsx(Input, { id: "invite-email", type: "email", placeholder: "kullanici@example.com", value: email, onChange: (e) => setEmail(e.target.value), required: true, autoFocus: true })] }), _jsxs("div", { className: "space-y-1.5", children: [_jsx(Label, { htmlFor: "invite-password", children: "Ba\u015Flang\u0131\u00E7 \u015Eifresi" }), _jsx(Input, { id: "invite-password", type: "password", placeholder: "En az 8 karakter", value: password, onChange: (e) => setPassword(e.target.value), minLength: 8, required: true })] }), _jsxs("div", { className: "space-y-1.5", children: [_jsx(Label, { htmlFor: "invite-role", children: "Rol" }), _jsxs(Select, { value: role, onValueChange: (v) => setRole(v), children: [_jsx(SelectTrigger, { id: "invite-role", children: _jsx(SelectValue, {}) }), _jsxs(SelectContent, { children: [_jsx(SelectItem, { value: "viewer", children: "Viewer \u2014 Sadece okuma" }), _jsx(SelectItem, { value: "editor", children: "Editor \u2014 Okuma + yazma" }), _jsx(SelectItem, { value: "admin", children: "Admin \u2014 Tam eri\u015Fim" })] })] })] }), _jsxs(DialogFooter, { className: "pt-2", children: [_jsx(Button, { type: "button", variant: "ghost", onClick: onClose, disabled: isPending, children: "\u0130ptal" }), _jsxs(Button, { type: "submit", disabled: isPending, children: [isPending && _jsx(Loader2, { className: "mr-2 h-4 w-4 animate-spin" }), "Davet Et"] })] })] })] }) }));
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
            toast.error(err instanceof Error ? err.message : "Güncelleme başarısız.");
        }
    }
    return (_jsx(Dialog, { open: open, onOpenChange: (v) => !v && onClose(), children: _jsxs(DialogContent, { className: "sm:max-w-md", children: [_jsx(DialogHeader, { children: _jsxs(DialogTitle, { className: "flex items-center gap-2", children: [_jsx(Pencil, { className: "h-4 w-4" }), "Kullan\u0131c\u0131y\u0131 D\u00FCzenle"] }) }), _jsxs("form", { onSubmit: handleSubmit, className: "space-y-4 pt-2", children: [_jsxs("div", { className: "space-y-1", children: [_jsx("p", { className: "text-xs text-muted-foreground", children: "E-posta" }), _jsx("p", { className: "text-sm font-medium", children: user.email })] }), _jsxs("div", { className: "space-y-1.5", children: [_jsx(Label, { htmlFor: "edit-role", children: "Rol" }), _jsxs(Select, { value: role, onValueChange: (v) => setRole(v), children: [_jsx(SelectTrigger, { id: "edit-role", children: _jsx(SelectValue, {}) }), _jsxs(SelectContent, { children: [_jsx(SelectItem, { value: "viewer", children: "Viewer" }), _jsx(SelectItem, { value: "editor", children: "Editor" }), _jsx(SelectItem, { value: "admin", children: "Admin" })] })] })] }), _jsxs("div", { className: "flex items-center justify-between rounded-md border border-border px-3 py-2", children: [_jsx("span", { className: "text-sm", children: "Hesap durumu" }), _jsx("button", { type: "button", onClick: () => setIsActive((v) => !v), className: cn("relative inline-flex h-5 w-9 items-center rounded-full transition-colors", isActive ? "bg-green-500" : "bg-muted"), children: _jsx("span", { className: cn("inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform", isActive ? "translate-x-4" : "translate-x-1") }) })] }), _jsxs(DialogFooter, { className: "pt-2", children: [_jsx(Button, { type: "button", variant: "ghost", onClick: onClose, disabled: isPending, children: "\u0130ptal" }), _jsxs(Button, { type: "submit", disabled: isPending, children: [isPending && _jsx(Loader2, { className: "mr-2 h-4 w-4 animate-spin" }), "Kaydet"] })] })] })] }) }));
}
function ResetPasswordDialog({ db, user, open, onClose }) {
    const [password, setPassword] = useState("");
    const [confirm, setConfirm] = useState("");
    const { mutateAsync, isPending } = useResetDbAuthUserPassword(db);
    const toast = useToast();
    async function handleSubmit(e) {
        e.preventDefault();
        if (password !== confirm) {
            toast.error("Şifreler eşleşmiyor.");
            return;
        }
        try {
            await mutateAsync({ id: user.id, password });
            toast.success("Şifre sıfırlandı. Mevcut oturumlar sonlandırıldı.");
            setPassword("");
            setConfirm("");
            onClose();
        }
        catch (err) {
            toast.error(err instanceof Error ? err.message : "Şifre sıfırlanamadı.");
        }
    }
    return (_jsx(Dialog, { open: open, onOpenChange: (v) => !v && onClose(), children: _jsxs(DialogContent, { className: "sm:max-w-md", children: [_jsx(DialogHeader, { children: _jsxs(DialogTitle, { className: "flex items-center gap-2", children: [_jsx(KeyRound, { className: "h-4 w-4" }), "\u015Eifre S\u0131f\u0131rla"] }) }), _jsxs("form", { onSubmit: handleSubmit, className: "space-y-4 pt-2", children: [_jsxs("div", { className: "space-y-1", children: [_jsx("p", { className: "text-xs text-muted-foreground", children: "Kullan\u0131c\u0131" }), _jsx("p", { className: "text-sm font-medium", children: user.email })] }), _jsxs("div", { className: "space-y-1.5", children: [_jsx(Label, { htmlFor: "reset-password", children: "Yeni \u015Eifre" }), _jsx(Input, { id: "reset-password", type: "password", placeholder: "En az 8 karakter", value: password, onChange: (e) => setPassword(e.target.value), minLength: 8, required: true, autoFocus: true })] }), _jsxs("div", { className: "space-y-1.5", children: [_jsx(Label, { htmlFor: "reset-confirm", children: "\u015Eifreyi Onayla" }), _jsx(Input, { id: "reset-confirm", type: "password", placeholder: "Tekrar girin", value: confirm, onChange: (e) => setConfirm(e.target.value), minLength: 8, required: true })] }), _jsx("p", { className: "text-xs text-muted-foreground", children: "\u015Eifre de\u011Fi\u015Ftirilince bu kullan\u0131c\u0131n\u0131n t\u00FCm mevcut oturumlar\u0131 sonland\u0131r\u0131l\u0131r." }), _jsxs(DialogFooter, { className: "pt-2", children: [_jsx(Button, { type: "button", variant: "ghost", onClick: onClose, disabled: isPending, children: "\u0130ptal" }), _jsxs(Button, { type: "submit", disabled: isPending, children: [isPending && _jsx(Loader2, { className: "mr-2 h-4 w-4 animate-spin" }), "S\u0131f\u0131rla"] })] })] })] }) }));
}
export function AuthsTab({ db }) {
    const { data, isLoading, error, refetch, isFetching } = useDbAuthUsers(db);
    const deleteUser = useDeleteDbAuthUser(db);
    const toast = useToast();
    const [inviteOpen, setInviteOpen] = useState(false);
    const [editUser, setEditUser] = useState(null);
    const [resetUser, setResetUser] = useState(null);
    const [deleteTarget, setDeleteTarget] = useState(null);
    async function handleDelete(user) {
        try {
            await deleteUser.mutateAsync(user.id);
            toast.success(`${user.email} silindi.`);
        }
        catch (err) {
            toast.error(err instanceof Error ? err.message : "Silme başarısız.");
        }
        finally {
            setDeleteTarget(null);
        }
    }
    return (_jsxs("div", { className: "space-y-4 p-4", children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsxs("div", { children: [_jsx("h2", { className: "text-sm font-semibold", children: "Kullan\u0131c\u0131lar" }), _jsx("p", { className: "text-xs text-muted-foreground mt-0.5", children: "Bu veritaban\u0131na eri\u015Fim yetkisi olan kullan\u0131c\u0131lar" })] }), _jsxs("div", { className: "flex items-center gap-2", children: [_jsx(Button, { variant: "ghost", size: "icon", onClick: () => refetch(), disabled: isFetching, title: "Yenile", children: _jsx(RefreshCw, { className: cn("h-4 w-4", isFetching && "animate-spin") }) }), _jsxs(Button, { size: "sm", onClick: () => setInviteOpen(true), children: [_jsx(UserPlus, { className: "mr-2 h-4 w-4" }), "Kullan\u0131c\u0131 Davet Et"] })] })] }), isLoading ? (_jsx("div", { className: "flex items-center justify-center py-16 text-muted-foreground", children: _jsx(Loader2, { className: "h-5 w-5 animate-spin" }) })) : error ? (_jsxs("div", { className: "flex flex-col items-center justify-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 py-12 text-center", children: [_jsx("p", { className: "text-sm text-destructive", children: error instanceof Error ? error.message : "Kullanıcılar yüklenemedi" }), _jsx(Button, { variant: "outline", size: "sm", onClick: () => refetch(), children: "Tekrar Dene" })] })) : !data?.users.length ? (_jsxs("div", { className: "flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border py-16 text-center", children: [_jsx("div", { className: "flex h-10 w-10 items-center justify-center rounded-full bg-muted", children: _jsx(UserPlus, { className: "h-5 w-5 text-muted-foreground" }) }), _jsxs("div", { children: [_jsx("p", { className: "text-sm font-medium", children: "Hen\u00FCz kullan\u0131c\u0131 yok" }), _jsx("p", { className: "text-xs text-muted-foreground mt-0.5", children: "\u0130lk kullan\u0131c\u0131y\u0131 davet ederek ba\u015Flay\u0131n." })] }), _jsxs(Button, { size: "sm", onClick: () => setInviteOpen(true), children: [_jsx(UserPlus, { className: "mr-2 h-4 w-4" }), "Kullan\u0131c\u0131 Davet Et"] })] })) : (_jsxs("div", { className: "rounded-md border border-border overflow-hidden", children: [_jsxs("table", { className: "w-full text-sm", children: [_jsx("thead", { children: _jsxs("tr", { className: "border-b border-border bg-muted/40", children: [_jsx("th", { className: "px-4 py-2.5 text-left text-xs font-medium text-muted-foreground", children: "E-posta" }), _jsx("th", { className: "px-4 py-2.5 text-left text-xs font-medium text-muted-foreground", children: "Rol" }), _jsx("th", { className: "px-4 py-2.5 text-left text-xs font-medium text-muted-foreground", children: "Durum" }), _jsx("th", { className: "px-4 py-2.5 text-left text-xs font-medium text-muted-foreground", children: "Son Giri\u015F" }), _jsx("th", { className: "px-4 py-2.5 text-left text-xs font-medium text-muted-foreground", children: "Olu\u015Fturuldu" }), _jsx("th", { className: "px-4 py-2.5 text-right text-xs font-medium text-muted-foreground", children: "\u0130\u015Flemler" })] }) }), _jsx("tbody", { className: "divide-y divide-border", children: data.users.map((user) => (_jsxs("tr", { className: "hover:bg-muted/20 transition-colors", children: [_jsx("td", { className: "px-4 py-3 font-medium", children: user.email }), _jsx("td", { className: "px-4 py-3", children: _jsx(RoleBadge, { role: user.role }) }), _jsx("td", { className: "px-4 py-3", children: user.is_active ? (_jsx(Badge, { variant: "outline", className: "border-green-500/40 bg-green-500/10 text-green-600 text-xs", children: "Aktif" })) : (_jsxs(Badge, { variant: "outline", className: "border-border text-muted-foreground text-xs", children: [_jsx(CircleSlash, { className: "mr-1 h-3 w-3" }), "Devre D\u0131\u015F\u0131"] })) }), _jsx("td", { className: "px-4 py-3 text-muted-foreground text-xs", children: formatDate(user.last_login) }), _jsx("td", { className: "px-4 py-3 text-muted-foreground text-xs", children: formatDate(user.created_at) }), _jsx("td", { className: "px-4 py-3", children: _jsxs("div", { className: "flex items-center justify-end gap-1", children: [_jsx(Button, { variant: "ghost", size: "icon", className: "h-7 w-7", title: "D\u00FCzenle", onClick: () => setEditUser(user), children: _jsx(Pencil, { className: "h-3.5 w-3.5" }) }), _jsx(Button, { variant: "ghost", size: "icon", className: "h-7 w-7", title: "\u015Eifre S\u0131f\u0131rla", onClick: () => setResetUser(user), children: _jsx(KeyRound, { className: "h-3.5 w-3.5" }) }), _jsx(Button, { variant: "ghost", size: "icon", className: "h-7 w-7 text-destructive hover:text-destructive", title: "Sil", onClick: () => setDeleteTarget(user), children: _jsx(Trash2, { className: "h-3.5 w-3.5" }) })] }) })] }, user.id))) })] }), _jsxs("div", { className: "px-4 py-2 border-t border-border bg-muted/20 text-xs text-muted-foreground", children: [data.total, " kullan\u0131c\u0131"] })] })), _jsx(InviteUserDialog, { db: db, open: inviteOpen, onClose: () => setInviteOpen(false) }), editUser && (_jsx(EditUserDialog, { db: db, user: editUser, open: true, onClose: () => setEditUser(null) })), resetUser && (_jsx(ResetPasswordDialog, { db: db, user: resetUser, open: true, onClose: () => setResetUser(null) })), deleteTarget && (_jsx(ConfirmDialog, { open: true, title: "Kullan\u0131c\u0131y\u0131 Sil", description: `"${deleteTarget.email}" adlı kullanıcı kalıcı olarak silinecek. Bu işlem geri alınamaz.`, confirmLabel: "Sil", onConfirm: () => handleDelete(deleteTarget), onCancel: () => setDeleteTarget(null) }))] }));
}
