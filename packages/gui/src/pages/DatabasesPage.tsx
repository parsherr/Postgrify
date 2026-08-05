/**
 * DatabasesPage — tüm veritabanları listesi + yeni DB oluşturma.
 */

import React from "react";
import { Link } from "react-router-dom";
import { Database, Plus, Trash2, HardDrive, Table2, Loader2, Power, PowerOff } from "lucide-react";
import { useDatabases, useCreateDatabase, useDeleteDatabase, useStopPool, useStartPool } from "@/hooks/useDatabases";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { formatBytes } from "@/lib/utils";

export default function DatabasesPage() {
  const { data: databases, isLoading } = useDatabases();
  const { mutateAsync: createDb, isPending: creating } = useCreateDatabase();
  const { mutateAsync: deleteDb, isPending: deleting } = useDeleteDatabase();
  const { mutateAsync: stopPool, isPending: stopping } = useStopPool();
  const { mutateAsync: startPool, isPending: starting } = useStartPool();
  const [poolLoadingDb, setPoolLoadingDb] = React.useState<string | null>(null);

  const [createOpen, setCreateOpen] = React.useState(false);
  const [newDbName, setNewDbName] = React.useState("");
  const [deleteTarget, setDeleteTarget] = React.useState<string | null>(null);
  const [createError, setCreateError] = React.useState<string | null>(null);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newDbName.trim()) return;
    setCreateError(null);
    try {
      await createDb(newDbName.trim());
      setNewDbName("");
      setCreateOpen(false);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Oluşturulamadı");
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    await deleteDb(deleteTarget);
    setDeleteTarget(null);
  }

  return (
    <div className="flex h-full flex-col gap-6 overflow-y-auto p-6">
      {/* Başlık */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-base font-semibold text-foreground">Databases</h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Bağlı PostgreSQL veritabanları
          </p>
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)} className="gap-1.5">
          <Plus className="h-3.5 w-3.5" />
          Yeni Veritabanı
        </Button>
      </div>

      {/* Liste */}
      <div className="rounded border border-border">
        {/* Tablo başlığı */}
        <div className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-6 border-b border-border px-4 py-2">
          <span className="text-2xs font-medium uppercase tracking-wider text-muted-foreground/60">
            Veritabanı
          </span>
          <span className="text-2xs font-medium uppercase tracking-wider text-muted-foreground/60 w-24 text-right">
            Tablolar
          </span>
          <span className="text-2xs font-medium uppercase tracking-wider text-muted-foreground/60 w-24 text-right">
            Boyut
          </span>
          <span className="w-8" />
        </div>

        {isLoading ? (
          <div className="space-y-px p-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : (
          <div>
            {databases?.map((db) => (
              <div
                key={db.name}
                className="group grid grid-cols-[1fr_auto_auto_auto_auto_auto] items-center gap-4 border-b border-border/40 px-4 py-3 transition-colors last:border-0 hover:bg-accent/10"
              >
                {/* DB adı + aktiflik göstergesi */}
                <Link
                  to={`/databases/${db.name}`}
                  className="flex items-center gap-2.5"
                >
                  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded border border-border bg-background">
                    <Database className="h-3 w-3 text-muted-foreground" />
                  </div>
                  <span className="font-mono text-sm text-foreground hover:underline">
                    {db.name}
                  </span>
                  {/* Pool durum noktası */}
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${db.pool_active ? "bg-green-500" : "bg-zinc-600"}`}
                    title={db.pool_active ? "Pool aktif" : "Pool kapalı"}
                  />
                </Link>

                <span className="flex w-20 items-center justify-end gap-1 font-mono text-xs text-muted-foreground">
                  <Table2 className="h-3 w-3" />
                  {db.table_count}
                </span>
                <span className="flex w-24 items-center justify-end gap-1 font-mono text-xs text-muted-foreground">
                  <HardDrive className="h-3 w-3" />
                  {formatBytes(db.size_bytes ?? 0)}
                </span>

                {/* Pool toggle butonu */}
                <button
                  onClick={async () => {
                    setPoolLoadingDb(db.name);
                    try {
                      if (db.pool_active) {
                        await stopPool(db.name);
                      } else {
                        await startPool(db.name);
                      }
                    } finally {
                      setPoolLoadingDb(null);
                    }
                  }}
                  disabled={poolLoadingDb === db.name || stopping || starting}
                  title={db.pool_active ? "Pool'u durdur" : "Pool'u başlat"}
                  className={`flex h-6 w-6 items-center justify-center rounded transition-all
                    ${db.pool_active
                      ? "text-muted-foreground/40 hover:bg-amber-950/40 hover:text-amber-400 opacity-0 group-hover:opacity-100"
                      : "text-green-500/70 hover:bg-green-950/40 hover:text-green-400"
                    }`}
                >
                  {poolLoadingDb === db.name ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : db.pool_active ? (
                    <PowerOff className="h-3.5 w-3.5" />
                  ) : (
                    <Power className="h-3.5 w-3.5" />
                  )}
                </button>

                {/* Sil butonu */}
                <button
                  onClick={() => setDeleteTarget(db.name)}
                  className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground/30 opacity-0 transition-all group-hover:opacity-100 hover:bg-red-950/50 hover:text-red-400"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}

            {databases?.length === 0 && (
              <div className="flex flex-col items-center gap-3 py-16 text-center">
                <Database className="h-8 w-8 text-muted-foreground/30" />
                <p className="text-xs text-muted-foreground">Veritabanı yok</p>
                <Button
                  size="sm"
                  onClick={() => setCreateOpen(true)}
                  className="gap-1.5"
                >
                  <Plus className="h-3.5 w-3.5" />
                  İlk Veritabanını Ekle
                </Button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Yeni DB dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Yeni Veritabanı</DialogTitle>
            <DialogDescription>
              PostgreSQL'de yeni bir veritabanı oluşturur.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="dbName">Veritabanı Adı</Label>
              <Input
                id="dbName"
                value={newDbName}
                onChange={(e) => setNewDbName(e.target.value)}
                placeholder="myapp_prod"
                autoFocus
                className="font-mono"
              />
              <p className="text-2xs text-muted-foreground">
                Harf, rakam ve alt çizgi içerebilir
              </p>
            </div>
            {createError && (
              <div className="rounded border border-red-900/50 bg-red-950/30 px-3 py-2">
                <p className="text-xs text-red-400">{createError}</p>
              </div>
            )}
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setCreateOpen(false)}
              >
                İptal
              </Button>
              <Button type="submit" disabled={creating || !newDbName.trim()}>
                {creating ? (
                  <>
                    <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                    Oluşturuluyor…
                  </>
                ) : (
                  "Oluştur"
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Silme onayı */}
      <Dialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Veritabanını Sil</DialogTitle>
            <DialogDescription>
              <span className="font-mono font-medium text-foreground">
                {deleteTarget}
              </span>{" "}
              veritabanı ve tüm tabloları kalıcı olarak silinecek.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteTarget(null)}>
              İptal
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? "Siliniyor…" : "Sil"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}