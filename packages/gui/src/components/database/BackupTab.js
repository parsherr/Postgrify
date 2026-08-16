import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
/**
 * BackupTab — Veritabanı yedekleme ve geri yükleme arayüzü.
 *
 * Tek sayfa: Backup listesi + Schedule konfigürasyonu + Restore bölümleri
 * Tüm backend bağlantıları useBackup.ts üzerinden yönetilir.
 */
import { useState, useRef } from "react";
import { Archive, CalendarClock, UploadCloud, Download, Trash2, Loader2, RefreshCw, Plus, AlertTriangle, Check, X, } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import { useBackups, useBackupSchedule, useCreateBackup, useDeleteBackup, useRestoreBackup, useSetBackupSchedule, useDeleteBackupSchedule, } from "../../hooks/useBackup.js";
import { downloadBackupUrl } from "../../lib/api.js";
import { cn } from "@/lib/utils";
// ── Yardımcı fonksiyonlar ──────────────────────────────────────────────────────
function fmtBytes(bytes) {
    if (bytes == null)
        return "—";
    if (bytes < 1024)
        return `${bytes} B`;
    if (bytes < 1024 * 1024)
        return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
function fmtDate(iso) {
    return new Intl.DateTimeFormat("tr-TR", {
        dateStyle: "medium",
        timeStyle: "short",
    }).format(new Date(iso));
}
const STATUS_META = {
    completed: { label: "Tamamlandı", className: "text-emerald-600 bg-emerald-500/10" },
    failed: { label: "Hata", className: "text-red-500 bg-red-500/10" },
    in_progress: { label: "Devam ediyor", className: "text-amber-500 bg-amber-500/10" },
};
function StatusBadge({ status }) {
    const meta = STATUS_META[status] ?? { label: status, className: "text-muted-foreground bg-muted" };
    return (_jsx("span", { className: cn("inline-flex items-center rounded px-2 py-0.5 text-xs font-medium", meta.className), children: meta.label }));
}
// ── Etkin/Pasif seçim düğmesi ─────────────────────────────────────────────────
function EnabledSelector({ value, onChange, }) {
    return (_jsxs("div", { className: "flex rounded-md overflow-hidden border border-border text-xs font-medium w-fit", children: [_jsxs("button", { type: "button", onClick: () => onChange(true), className: cn("flex items-center gap-1.5 px-3 py-1.5 transition-colors", value
                    ? "bg-emerald-500/15 text-emerald-600"
                    : "bg-transparent text-muted-foreground hover:bg-muted/50"), children: [_jsx(Check, { className: "h-3 w-3" }), "Etkin"] }), _jsx("div", { className: "w-px bg-border" }), _jsxs("button", { type: "button", onClick: () => onChange(false), className: cn("flex items-center gap-1.5 px-3 py-1.5 transition-colors", !value
                    ? "bg-muted text-foreground"
                    : "bg-transparent text-muted-foreground hover:bg-muted/50"), children: [_jsx(X, { className: "h-3 w-3" }), "Pasif"] })] }));
}
// ── Bölüm 1: Backup Listesi ───────────────────────────────────────────────────
function BackupListSection({ db }) {
    const { data: backups, isLoading, error, refetch, isFetching } = useBackups(db);
    const createMutation = useCreateBackup(db);
    const deleteMutation = useDeleteBackup(db);
    const toast = useToast();
    const [deleteTarget, setDeleteTarget] = useState(null);
    function handleCreate() {
        createMutation.mutate(undefined, {
            onSuccess: () => toast.success("Yedekleme tamamlandı."),
            onError: (err) => toast.error(`Yedekleme hatası: ${err.message}`),
        });
    }
    function handleDelete(id) {
        deleteMutation.mutate(id, {
            onSuccess: () => { setDeleteTarget(null); toast.success("Yedek silindi."); },
            onError: (err) => { setDeleteTarget(null); toast.error(`Silme hatası: ${err.message}`); },
        });
    }
    return (_jsxs("section", { children: [_jsxs("div", { className: "flex items-center justify-between px-4 py-3 border-b border-border", children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsx(Archive, { className: "h-4 w-4 text-muted-foreground" }), _jsx("span", { className: "text-sm font-medium", children: "Backup Listesi" }), backups && backups.length > 0 && (_jsx("span", { className: "text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded", children: backups.length }))] }), _jsxs("div", { className: "flex items-center gap-2", children: [_jsx(Button, { variant: "ghost", size: "sm", onClick: () => refetch(), disabled: isFetching, className: "h-7 w-7 p-0", children: _jsx(RefreshCw, { className: cn("h-3.5 w-3.5", isFetching && "animate-spin") }) }), _jsxs(Button, { size: "sm", onClick: handleCreate, disabled: createMutation.isPending, className: "h-7 gap-1.5", children: [createMutation.isPending
                                        ? _jsx(Loader2, { className: "h-3.5 w-3.5 animate-spin" })
                                        : _jsx(Plus, { className: "h-3.5 w-3.5" }), "Yeni Backup"] })] })] }), isLoading ? (_jsx("div", { className: "flex items-center justify-center py-10", children: _jsx(Loader2, { className: "h-5 w-5 animate-spin text-muted-foreground" }) })) : error ? (_jsxs("div", { className: "flex items-center gap-2 px-4 py-4 text-sm text-red-500", children: [_jsx(AlertTriangle, { className: "h-4 w-4 shrink-0" }), error.message] })) : !backups || backups.length === 0 ? (_jsxs("div", { className: "flex flex-col items-center justify-center py-10 gap-2 text-center", children: [_jsx(Archive, { className: "h-7 w-7 text-muted-foreground/30" }), _jsx("p", { className: "text-sm text-muted-foreground", children: "Hen\u00FCz kay\u0131tl\u0131 yedek yok." }), _jsxs(Button, { variant: "outline", size: "sm", onClick: handleCreate, disabled: createMutation.isPending, className: "mt-1 gap-1.5 h-7", children: [createMutation.isPending
                                ? _jsx(Loader2, { className: "h-3.5 w-3.5 animate-spin" })
                                : _jsx(Plus, { className: "h-3.5 w-3.5" }), "Backup Olu\u015Ftur"] })] })) : (_jsxs("table", { className: "w-full text-xs", children: [_jsx("thead", { className: "bg-muted/30 text-muted-foreground", children: _jsxs("tr", { children: [_jsx("th", { className: "px-4 py-2.5 text-left font-medium", children: "Tarih" }), _jsx("th", { className: "px-4 py-2.5 text-left font-medium", children: "Boyut" }), _jsx("th", { className: "px-4 py-2.5 text-left font-medium", children: "Durum" }), _jsx("th", { className: "px-4 py-2.5 text-right font-medium", children: "\u0130\u015Flemler" })] }) }), _jsx("tbody", { className: "divide-y divide-border", children: backups.map((b) => (_jsxs("tr", { className: "hover:bg-muted/20 transition-colors", children: [_jsx("td", { className: "px-4 py-2.5 text-foreground", children: fmtDate(b.created_at) }), _jsx("td", { className: "px-4 py-2.5 text-muted-foreground", children: fmtBytes(b.size_bytes) }), _jsx("td", { className: "px-4 py-2.5", children: _jsx(StatusBadge, { status: b.status }) }), _jsx("td", { className: "px-4 py-2.5", children: _jsxs("div", { className: "flex items-center justify-end gap-1", children: [b.status === "completed" && (_jsxs("a", { href: downloadBackupUrl(db, b.id), download: true, className: cn("inline-flex items-center gap-1 h-7 px-2 rounded-md text-xs font-medium", "text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"), children: [_jsx(Download, { className: "h-3.5 w-3.5" }), "\u0130ndir"] })), _jsx(Button, { variant: "ghost", size: "sm", className: "h-7 w-7 p-0 text-muted-foreground hover:text-red-500", onClick: () => setDeleteTarget(b.id), children: _jsx(Trash2, { className: "h-3.5 w-3.5" }) })] }) })] }, b.id))) })] })), _jsx(ConfirmDialog, { open: deleteTarget !== null, title: "Yede\u011Fi Sil", description: "Bu yedek kal\u0131c\u0131 olarak silinecek. Bu i\u015Flem geri al\u0131namaz.", confirmLabel: "Sil", danger: true, onConfirm: () => deleteTarget && handleDelete(deleteTarget), onCancel: () => setDeleteTarget(null) })] }));
}
// ── Bölüm 2: Schedule ────────────────────────────────────────────────────────
const DEFAULT_SCHEDULE = {
    cron: "0 2 * * *",
    enabled: true,
    retain: 7,
};
function ScheduleSection({ db }) {
    const { data: schedule, isLoading } = useBackupSchedule(db);
    const setMutation = useSetBackupSchedule(db);
    const deleteMutation = useDeleteBackupSchedule(db);
    const toast = useToast();
    const [form, setForm] = useState(DEFAULT_SCHEDULE);
    const [initialized, setInitialized] = useState(false);
    const [deleteOpen, setDeleteOpen] = useState(false);
    if (!initialized && !isLoading) {
        if (schedule)
            setForm(schedule);
        setInitialized(true);
    }
    function handleSubmit(e) {
        e.preventDefault();
        setMutation.mutate(form, {
            onSuccess: () => toast.success("Program kaydedildi."),
            onError: (err) => toast.error(`Hata: ${err.message}`),
        });
    }
    function handleDelete() {
        deleteMutation.mutate(undefined, {
            onSuccess: () => {
                setDeleteOpen(false);
                setForm(DEFAULT_SCHEDULE);
                setInitialized(false);
                toast.success("Program iptal edildi.");
            },
            onError: (err) => { setDeleteOpen(false); toast.error(`Hata: ${err.message}`); },
        });
    }
    return (_jsxs("section", { className: "border-t border-border", children: [_jsxs("div", { className: "flex items-center gap-2 px-4 py-3 border-b border-border", children: [_jsx(CalendarClock, { className: "h-4 w-4 text-muted-foreground" }), _jsx("span", { className: "text-sm font-medium", children: "Otomatik Yedekleme Program\u0131" })] }), isLoading ? (_jsx("div", { className: "flex items-center justify-center py-8", children: _jsx(Loader2, { className: "h-5 w-5 animate-spin text-muted-foreground" }) })) : (_jsxs("form", { onSubmit: handleSubmit, className: "px-4 py-4 space-y-4", children: [_jsxs("div", { className: "grid grid-cols-[1fr_auto_auto] gap-4 items-end max-w-xl", children: [_jsxs("div", { className: "space-y-1.5", children: [_jsx(Label, { htmlFor: "cron", className: "text-xs", children: "Cron \u0130fadesi" }), _jsx(Input, { id: "cron", value: form.cron, onChange: (e) => setForm((f) => ({ ...f, cron: e.target.value })), placeholder: "0 2 * * *", className: "h-8 text-xs font-mono" }), _jsxs("p", { className: "text-[11px] text-muted-foreground", children: ["dak saat g\u00FCn ay hf \u00A0\u00B7\u00A0 \u00F6rn: ", _jsx("code", { className: "font-mono", children: "0 2 * * *" })] })] }), _jsxs("div", { className: "space-y-1.5 w-24", children: [_jsx(Label, { htmlFor: "retain", className: "text-xs", children: "Saklama" }), _jsx(Input, { id: "retain", type: "number", min: 1, max: 100, value: form.retain, onChange: (e) => setForm((f) => ({ ...f, retain: Number(e.target.value) })), className: "h-8 text-xs" }), _jsx("p", { className: "text-[11px] text-muted-foreground", children: "yedek say\u0131s\u0131" })] }), _jsxs("div", { className: "space-y-1.5", children: [_jsx(Label, { className: "text-xs", children: "Durum" }), _jsx(EnabledSelector, { value: form.enabled, onChange: (v) => setForm((f) => ({ ...f, enabled: v })) })] })] }), _jsxs("div", { className: "flex items-center gap-3", children: [_jsxs(Button, { type: "submit", size: "sm", disabled: setMutation.isPending, className: "h-7 gap-1.5", children: [setMutation.isPending
                                        ? _jsx(Loader2, { className: "h-3.5 w-3.5 animate-spin" })
                                        : _jsx(Check, { className: "h-3.5 w-3.5" }), "Kaydet"] }), schedule && (_jsxs(Button, { type: "button", variant: "ghost", size: "sm", onClick: () => setDeleteOpen(true), disabled: deleteMutation.isPending, className: "h-7 gap-1.5 text-muted-foreground hover:text-red-500", children: [_jsx(Trash2, { className: "h-3.5 w-3.5" }), "Program\u0131 Sil"] }))] })] })), _jsx(ConfirmDialog, { open: deleteOpen, title: "Program\u0131 \u0130ptal Et", description: "Otomatik yedekleme program\u0131 silinecek. Mevcut yedekler korunur.", confirmLabel: "\u0130ptal Et", danger: true, onConfirm: handleDelete, onCancel: () => setDeleteOpen(false) })] }));
}
// ── Bölüm 3: Geri Yükle ──────────────────────────────────────────────────────
function RestoreSection({ db }) {
    const restoreMutation = useRestoreBackup(db);
    const toast = useToast();
    const fileInputRef = useRef(null);
    const [file, setFile] = useState(null);
    const [confirmOpen, setConfirmOpen] = useState(false);
    function handleFileChange(e) {
        setFile(e.target.files?.[0] ?? null);
    }
    function clearFile() {
        setFile(null);
        if (fileInputRef.current)
            fileInputRef.current.value = "";
    }
    function handleRestore() {
        if (!file)
            return;
        restoreMutation.mutate(file, {
            onSuccess: () => {
                clearFile();
                setConfirmOpen(false);
                toast.success(`"${db}" veritabanı başarıyla geri yüklendi.`);
            },
            onError: (err) => {
                setConfirmOpen(false);
                toast.error(`Geri yükleme hatası: ${err.message}`);
            },
        });
    }
    return (_jsxs("section", { className: "border-t border-border", children: [_jsxs("div", { className: "flex items-center gap-2 px-4 py-3 border-b border-border", children: [_jsx(UploadCloud, { className: "h-4 w-4 text-muted-foreground" }), _jsx("span", { className: "text-sm font-medium", children: "Geri Y\u00FCkle" })] }), _jsxs("div", { className: "px-4 py-4 space-y-3 max-w-xl", children: [_jsxs("div", { className: "flex items-start gap-2 rounded-md border border-amber-300/50 bg-amber-50/50 dark:bg-amber-500/10 px-3 py-2.5", children: [_jsx(AlertTriangle, { className: "h-3.5 w-3.5 text-amber-500 mt-0.5 shrink-0" }), _jsxs("p", { className: "text-xs text-amber-700 dark:text-amber-400", children: ["Geri y\u00FCkleme ", _jsx("strong", { children: db }), " \u00FCzerindeki mevcut verilerin \u00FCzerine yazar. \u0130\u015Flem geri al\u0131namaz."] })] }), _jsxs("div", { className: "flex items-center gap-2", children: [_jsxs("label", { htmlFor: "restore-file", className: cn("flex items-center gap-2 px-3 py-1.5 rounded-md border border-dashed border-border", "hover:border-primary/50 hover:bg-muted/20 transition-colors cursor-pointer text-xs min-w-0"), children: [_jsx(UploadCloud, { className: "h-3.5 w-3.5 shrink-0 text-muted-foreground" }), file ? (_jsxs(_Fragment, { children: [_jsx("span", { className: "text-foreground font-medium truncate max-w-[180px]", children: file.name }), _jsx("span", { className: "text-muted-foreground shrink-0", children: fmtBytes(file.size) })] })) : (_jsx("span", { className: "text-muted-foreground", children: ".sql.gz dosyas\u0131 se\u00E7" })), _jsx("input", { id: "restore-file", ref: fileInputRef, type: "file", accept: ".gz,.sql.gz", className: "sr-only", onChange: handleFileChange })] }), file && (_jsx("button", { type: "button", onClick: clearFile, className: "h-7 w-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors shrink-0", children: _jsx(X, { className: "h-3.5 w-3.5" }) })), _jsxs(Button, { onClick: () => setConfirmOpen(true), disabled: !file || restoreMutation.isPending, size: "sm", variant: "destructive", className: "h-7 gap-1.5 shrink-0", children: [restoreMutation.isPending
                                        ? _jsx(Loader2, { className: "h-3.5 w-3.5 animate-spin" })
                                        : _jsx(UploadCloud, { className: "h-3.5 w-3.5" }), "Geri Y\u00FCkle"] })] })] }), _jsx(ConfirmDialog, { open: confirmOpen, title: "Geri Y\u00FCklemeyi Onayla", description: `"${db}" veritabanı "${file?.name}" dosyasından geri yüklenecek. Mevcut veriler silinecek. Devam etmek istiyor musunuz?`, confirmLabel: "Geri Y\u00FCkle", danger: true, onConfirm: handleRestore, onCancel: () => setConfirmOpen(false) })] }));
}
export function BackupTab({ db }) {
    return (_jsxs("div", { className: "overflow-auto h-full", children: [_jsx(BackupListSection, { db: db }), _jsx(ScheduleSection, { db: db }), _jsx(RestoreSection, { db: db })] }));
}
