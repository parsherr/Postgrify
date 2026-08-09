/**
 * BackupTab — Veritabanı yedekleme ve geri yükleme arayüzü.
 *
 * Tek sayfa: Backup listesi + Schedule konfigürasyonu + Restore bölümleri
 * Tüm backend bağlantıları useBackup.ts üzerinden yönetilir.
 */

import { useState, useRef } from "react";
import {
  Archive, CalendarClock, UploadCloud,
  Download, Trash2, Loader2, RefreshCw,
  Plus, AlertTriangle, Check, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import {
  useBackups,
  useBackupSchedule,
  useCreateBackup,
  useDeleteBackup,
  useRestoreBackup,
  useSetBackupSchedule,
  useDeleteBackupSchedule,
} from "../../hooks/useBackup.js";
import { downloadBackupUrl } from "../../lib/api.js";
import type { BackupScheduleConfig } from "../../lib/api.js";
import { cn } from "@/lib/utils";

// ── Yardımcı fonksiyonlar ──────────────────────────────────────────────────────

function fmtBytes(bytes: number | null): string {
  if (bytes == null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function fmtDate(iso: string): string {
  return new Intl.DateTimeFormat("tr-TR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));
}

// ── Durum badge'i ──────────────────────────────────────────────────────────────

type BackupStatus = "completed" | "failed" | "in_progress";

const STATUS_META: Record<BackupStatus, { label: string; className: string }> = {
  completed:   { label: "Tamamlandı",   className: "text-emerald-600 bg-emerald-500/10" },
  failed:      { label: "Hata",          className: "text-red-500 bg-red-500/10" },
  in_progress: { label: "Devam ediyor", className: "text-amber-500 bg-amber-500/10" },
};

function StatusBadge({ status }: { status: BackupStatus }) {
  const meta = STATUS_META[status] ?? { label: status, className: "text-muted-foreground bg-muted" };
  return (
    <span className={cn("inline-flex items-center rounded px-2 py-0.5 text-xs font-medium", meta.className)}>
      {meta.label}
    </span>
  );
}

// ── Etkin/Pasif seçim düğmesi ─────────────────────────────────────────────────

function EnabledSelector({
  value,
  onChange,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex rounded-md overflow-hidden border border-border text-xs font-medium w-fit">
      <button
        type="button"
        onClick={() => onChange(true)}
        className={cn(
          "flex items-center gap-1.5 px-3 py-1.5 transition-colors",
          value
            ? "bg-emerald-500/15 text-emerald-600"
            : "bg-transparent text-muted-foreground hover:bg-muted/50"
        )}
      >
        <Check className="h-3 w-3" />
        Etkin
      </button>
      <div className="w-px bg-border" />
      <button
        type="button"
        onClick={() => onChange(false)}
        className={cn(
          "flex items-center gap-1.5 px-3 py-1.5 transition-colors",
          !value
            ? "bg-muted text-foreground"
            : "bg-transparent text-muted-foreground hover:bg-muted/50"
        )}
      >
        <X className="h-3 w-3" />
        Pasif
      </button>
    </div>
  );
}

// ── Bölüm 1: Backup Listesi ───────────────────────────────────────────────────

function BackupListSection({ db }: { db: string }) {
  const { data: backups, isLoading, error, refetch, isFetching } = useBackups(db);
  const createMutation = useCreateBackup(db);
  const deleteMutation = useDeleteBackup(db);
  const toast = useToast();
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  function handleCreate() {
    createMutation.mutate(undefined, {
      onSuccess: () => toast.success("Yedekleme tamamlandı."),
      onError:   (err) => toast.error(`Yedekleme hatası: ${(err as Error).message}`),
    });
  }

  function handleDelete(id: string) {
    deleteMutation.mutate(id, {
      onSuccess: () => { setDeleteTarget(null); toast.success("Yedek silindi."); },
      onError:   (err) => { setDeleteTarget(null); toast.error(`Silme hatası: ${(err as Error).message}`); },
    });
  }

  return (
    <section>
      {/* Başlık satırı */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <Archive className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">Backup Listesi</span>
          {backups && backups.length > 0 && (
            <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
              {backups.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
            className="h-7 w-7 p-0"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", isFetching && "animate-spin")} />
          </Button>
          <Button
            size="sm"
            onClick={handleCreate}
            disabled={createMutation.isPending}
            className="h-7 gap-1.5"
          >
            {createMutation.isPending
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <Plus className="h-3.5 w-3.5" />}
            Yeni Backup
          </Button>
        </div>
      </div>

      {/* Tablo */}
      {isLoading ? (
        <div className="flex items-center justify-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : error ? (
        <div className="flex items-center gap-2 px-4 py-4 text-sm text-red-500">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {(error as Error).message}
        </div>
      ) : !backups || backups.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-10 gap-2 text-center">
          <Archive className="h-7 w-7 text-muted-foreground/30" />
          <p className="text-sm text-muted-foreground">Henüz kayıtlı yedek yok.</p>
          <Button
            variant="outline"
            size="sm"
            onClick={handleCreate}
            disabled={createMutation.isPending}
            className="mt-1 gap-1.5 h-7"
          >
            {createMutation.isPending
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <Plus className="h-3.5 w-3.5" />}
            Backup Oluştur
          </Button>
        </div>
      ) : (
        <table className="w-full text-xs">
          <thead className="bg-muted/30 text-muted-foreground">
            <tr>
              <th className="px-4 py-2.5 text-left font-medium">Tarih</th>
              <th className="px-4 py-2.5 text-left font-medium">Boyut</th>
              <th className="px-4 py-2.5 text-left font-medium">Durum</th>
              <th className="px-4 py-2.5 text-right font-medium">İşlemler</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {backups.map((b) => (
              <tr key={b.id} className="hover:bg-muted/20 transition-colors">
                <td className="px-4 py-2.5 text-foreground">{fmtDate(b.created_at)}</td>
                <td className="px-4 py-2.5 text-muted-foreground">{fmtBytes(b.size_bytes)}</td>
                <td className="px-4 py-2.5">
                  <StatusBadge status={b.status} />
                </td>
                <td className="px-4 py-2.5">
                  <div className="flex items-center justify-end gap-1">
                    {b.status === "completed" && (
                      <a
                        href={downloadBackupUrl(db, b.id)}
                        download
                        className={cn(
                          "inline-flex items-center gap-1 h-7 px-2 rounded-md text-xs font-medium",
                          "text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                        )}
                      >
                        <Download className="h-3.5 w-3.5" />
                        İndir
                      </a>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0 text-muted-foreground hover:text-red-500"
                      onClick={() => setDeleteTarget(b.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Yedeği Sil"
        description="Bu yedek kalıcı olarak silinecek. Bu işlem geri alınamaz."
        confirmLabel="Sil"
        danger
        onConfirm={() => deleteTarget && handleDelete(deleteTarget)}
        onCancel={() => setDeleteTarget(null)}
      />
    </section>
  );
}

// ── Bölüm 2: Schedule ────────────────────────────────────────────────────────

const DEFAULT_SCHEDULE: BackupScheduleConfig = {
  cron: "0 2 * * *",
  enabled: true,
  retain: 7,
};

function ScheduleSection({ db }: { db: string }) {
  const { data: schedule, isLoading } = useBackupSchedule(db);
  const setMutation = useSetBackupSchedule(db);
  const deleteMutation = useDeleteBackupSchedule(db);
  const toast = useToast();

  const [form, setForm] = useState<BackupScheduleConfig>(DEFAULT_SCHEDULE);
  const [initialized, setInitialized] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  if (!initialized && !isLoading) {
    if (schedule) setForm(schedule);
    setInitialized(true);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMutation.mutate(form, {
      onSuccess: () => toast.success("Program kaydedildi."),
      onError:   (err) => toast.error(`Hata: ${(err as Error).message}`),
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
      onError: (err) => { setDeleteOpen(false); toast.error(`Hata: ${(err as Error).message}`); },
    });
  }

  return (
    <section className="border-t border-border">
      {/* Başlık */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
        <CalendarClock className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium">Otomatik Yedekleme Programı</span>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="px-4 py-4 space-y-4">
          {/* 3 alan yan yana — max 480px genişlikte tutuyoruz */}
          <div className="grid grid-cols-[1fr_auto_auto] gap-4 items-end max-w-xl">
            {/* Cron */}
            <div className="space-y-1.5">
              <Label htmlFor="cron" className="text-xs">Cron İfadesi</Label>
              <Input
                id="cron"
                value={form.cron}
                onChange={(e) => setForm((f) => ({ ...f, cron: e.target.value }))}
                placeholder="0 2 * * *"
                className="h-8 text-xs font-mono"
              />
              <p className="text-[11px] text-muted-foreground">
                dak saat gün ay hf &nbsp;·&nbsp; örn: <code className="font-mono">0 2 * * *</code>
              </p>
            </div>

            {/* Retain */}
            <div className="space-y-1.5 w-24">
              <Label htmlFor="retain" className="text-xs">Saklama</Label>
              <Input
                id="retain"
                type="number"
                min={1}
                max={100}
                value={form.retain}
                onChange={(e) => setForm((f) => ({ ...f, retain: Number(e.target.value) }))}
                className="h-8 text-xs"
              />
              <p className="text-[11px] text-muted-foreground">yedek sayısı</p>
            </div>

            {/* Durum */}
            <div className="space-y-1.5">
              <Label className="text-xs">Durum</Label>
              <EnabledSelector
                value={form.enabled}
                onChange={(v) => setForm((f) => ({ ...f, enabled: v }))}
              />
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Button type="submit" size="sm" disabled={setMutation.isPending} className="h-7 gap-1.5">
              {setMutation.isPending
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <Check className="h-3.5 w-3.5" />}
              Kaydet
            </Button>
            {schedule && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setDeleteOpen(true)}
                disabled={deleteMutation.isPending}
                className="h-7 gap-1.5 text-muted-foreground hover:text-red-500"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Programı Sil
              </Button>
            )}
          </div>
        </form>
      )}

      <ConfirmDialog
        open={deleteOpen}
        title="Programı İptal Et"
        description="Otomatik yedekleme programı silinecek. Mevcut yedekler korunur."
        confirmLabel="İptal Et"
        danger
        onConfirm={handleDelete}
        onCancel={() => setDeleteOpen(false)}
      />
    </section>
  );
}

// ── Bölüm 3: Geri Yükle ──────────────────────────────────────────────────────

function RestoreSection({ db }: { db: string }) {
  const restoreMutation = useRestoreBackup(db);
  const toast = useToast();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    setFile(e.target.files?.[0] ?? null);
  }

  function clearFile() {
    setFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function handleRestore() {
    if (!file) return;
    restoreMutation.mutate(file, {
      onSuccess: () => {
        clearFile();
        setConfirmOpen(false);
        toast.success(`"${db}" veritabanı başarıyla geri yüklendi.`);
      },
      onError: (err) => {
        setConfirmOpen(false);
        toast.error(`Geri yükleme hatası: ${(err as Error).message}`);
      },
    });
  }

  return (
    <section className="border-t border-border">
      {/* Başlık */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
        <UploadCloud className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium">Geri Yükle</span>
      </div>

      <div className="px-4 py-4 space-y-3 max-w-xl">
        {/* Uyarı */}
        <div className="flex items-start gap-2 rounded-md border border-amber-300/50 bg-amber-50/50 dark:bg-amber-500/10 px-3 py-2.5">
          <AlertTriangle className="h-3.5 w-3.5 text-amber-500 mt-0.5 shrink-0" />
          <p className="text-xs text-amber-700 dark:text-amber-400">
            Geri yükleme <strong>{db}</strong> üzerindeki mevcut verilerin üzerine yazar. İşlem geri alınamaz.
          </p>
        </div>

        {/* Dosya seçimi + Buton — tek satırda */}
        <div className="flex items-center gap-2">
          <label
            htmlFor="restore-file"
            className={cn(
              "flex items-center gap-2 px-3 py-1.5 rounded-md border border-dashed border-border",
              "hover:border-primary/50 hover:bg-muted/20 transition-colors cursor-pointer text-xs min-w-0"
            )}
          >
            <UploadCloud className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            {file ? (
              <>
                <span className="text-foreground font-medium truncate max-w-[180px]">{file.name}</span>
                <span className="text-muted-foreground shrink-0">{fmtBytes(file.size)}</span>
              </>
            ) : (
              <span className="text-muted-foreground">.sql.gz dosyası seç</span>
            )}
            <input
              id="restore-file"
              ref={fileInputRef}
              type="file"
              accept=".gz,.sql.gz"
              className="sr-only"
              onChange={handleFileChange}
            />
          </label>

          {file && (
            <button
              type="button"
              onClick={clearFile}
              className="h-7 w-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors shrink-0"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}

          <Button
            onClick={() => setConfirmOpen(true)}
            disabled={!file || restoreMutation.isPending}
            size="sm"
            variant="destructive"
            className="h-7 gap-1.5 shrink-0"
          >
            {restoreMutation.isPending
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <UploadCloud className="h-3.5 w-3.5" />}
            Geri Yükle
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title="Geri Yüklemeyi Onayla"
        description={`"${db}" veritabanı "${file?.name}" dosyasından geri yüklenecek. Mevcut veriler silinecek. Devam etmek istiyor musunuz?`}
        confirmLabel="Geri Yükle"
        danger
        onConfirm={handleRestore}
        onCancel={() => setConfirmOpen(false)}
      />
    </section>
  );
}

// ── Ana bileşen ────────────────────────────────────────────────────────────────

interface BackupTabProps {
  db: string;
}

export function BackupTab({ db }: BackupTabProps) {
  return (
    <div className="overflow-auto h-full">
      <BackupListSection db={db} />
      <ScheduleSection   db={db} />
      <RestoreSection    db={db} />
    </div>
  );
}