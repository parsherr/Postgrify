/**
 * DatabasesPage — Managed database'lerin listesi.
 *
 * Veritabanı oluşturulduğunda API key tek seferlik bir modal'da gösterilir.
 */

import React, { useState } from "react";
import { Link } from "react-router-dom";
import {
  Database as DatabaseIcon,
  Plus,
  Trash2,
  Loader2,
  ChevronRight,
  Copy,
  Check,
  KeyRound,
  Eye,
  EyeOff,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { formatBytes, cn } from "@/lib/utils";
import {
  useDatabases,
  useCreateDatabase,
  useDeleteDatabase,
} from "@/hooks/useDatabases";
import type { Database } from "@/types";

// ── Yardımcı: kopyalama butonu ───────────────────────────────────────────────

function CopyButton({ text, className }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button
      onClick={handleCopy}
      className={cn(
        "inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs transition-colors",
        "bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground",
        className
      )}
    >
      {copied ? (
        <Check className="h-3.5 w-3.5 text-green-500" />
      ) : (
        <Copy className="h-3.5 w-3.5" />
      )}
      {copied ? "Kopyalandı" : "Kopyala"}
    </button>
  );
}

// ── API Key Modal ─────────────────────────────────────────────────────────────

interface ApiKeyModalProps {
  dbName: string;
  apiKey: string;
  onClose: () => void;
}

function ApiKeyModal({ dbName, apiKey, onClose }: ApiKeyModalProps) {
  const [revealed, setRevealed] = useState(false);

  return (
    <Dialog open onOpenChange={() => onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="h-5 w-5 text-amber-500" />
            API Key oluşturuldu
          </DialogTitle>
          <DialogDescription>
            <strong>{dbName}</strong> veritabanı için API key aşağıda
            gösterilmektedir. Bu key bir daha tam olarak gösterilmeyecektir —
            şimdi kopyalayın.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-lg border bg-muted/40 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <code className="flex-1 break-all text-sm font-mono text-foreground select-all">
              {revealed ? apiKey : "•".repeat(Math.min(apiKey.length, 48))}
            </code>
            <button
              onClick={() => setRevealed((v) => !v)}
              className="shrink-0 rounded p-1 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              title={revealed ? "Gizle" : "Göster"}
            >
              {revealed ? (
                <EyeOff className="h-4 w-4" />
              ) : (
                <Eye className="h-4 w-4" />
              )}
            </button>
          </div>
          <div className="flex justify-end">
            <CopyButton text={apiKey} />
          </div>
        </div>

        <div className="rounded-md border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30 p-3 text-sm text-amber-800 dark:text-amber-300 space-y-1.5">
          <p className="font-medium">SDK Kullanımı</p>
          <pre className="text-xs whitespace-pre-wrap break-all font-mono">
{`import { createClient } from '@postgrify/auth-js'

const auth = createClient({
  url: 'http://localhost:3000',
  database: '${dbName}',
  apiKey: '${revealed ? apiKey : "<api_key>"}',
})`}
          </pre>
        </div>

        <DialogFooter>
          <Button onClick={onClose}>Anladım, kapattım</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Ana sayfa ────────────────────────────────────────────────────────────────

export default function DatabasesPage() {
  const { data, isLoading } = useDatabases();
  const createDb = useCreateDatabase();
  const deleteDb = useDeleteDatabase();

  const [newDbName, setNewDbName] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [createdApiKey, setCreatedApiKey] = useState<{
    dbName: string;
    key: string;
  } | null>(null);

  const databases: Database[] = Array.isArray(data) ? data : [];

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDbName.trim()) return;
    createDb.mutate(newDbName.trim(), {
      onSuccess: (result: { name: string; created: boolean; api_key?: string }) => {
        if (result.api_key) {
          setCreatedApiKey({ dbName: result.name, key: result.api_key });
        }
        setNewDbName("");
      },
    });
  };

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {/* Başlık */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Veritabanları</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Her veritabanı izole bir PostgreSQL şeması ve auth sistemine sahiptir.
        </p>
      </div>

      {/* Yeni DB oluştur */}
      <form
        onSubmit={handleCreate}
        className="flex gap-2 items-center"
      >
        <Input
          value={newDbName}
          onChange={(e) => setNewDbName(e.target.value)}
          placeholder="Veritabanı adı (örn: myapp)"
          className="max-w-xs font-mono"
          pattern="[a-zA-Z_][a-zA-Z0-9_]*"
          title="Harf/alt çizgi ile başlamalı, yalnızca harf/rakam/alt çizgi içerebilir"
        />
        <Button type="submit" disabled={createDb.isPending || !newDbName.trim()}>
          {createDb.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Plus className="h-4 w-4" />
          )}
          Oluştur
        </Button>
      </form>
      {createDb.isError && (
        <p className="text-sm text-destructive">
          {(createDb.error as Error)?.message ?? "Veritabanı oluşturulamadı"}
        </p>
      )}

      {/* Liste */}
      {isLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground text-sm py-8">
          <Loader2 className="h-4 w-4 animate-spin" />
          Yükleniyor…
        </div>
      ) : databases.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-muted-foreground">
          <DatabaseIcon className="h-8 w-8 mx-auto mb-3 opacity-40" />
          <p className="text-sm">Henüz veritabanı yok.</p>
        </div>
      ) : (
        <div className="divide-y rounded-lg border">
          {databases.map((db) => (
            <div
              key={db.name}
              className="flex items-center justify-between px-4 py-3 hover:bg-muted/30 transition-colors group"
            >
              <div className="flex items-center gap-3 min-w-0">
                <DatabaseIcon className="h-4 w-4 text-muted-foreground shrink-0" />
                <Link
                  to={`/databases/${db.name}`}
                  className="font-medium text-sm hover:underline truncate"
                >
                  {db.name}
                </Link>
                              </div>

              <div className="flex items-center gap-4 text-xs text-muted-foreground">
                <span>{formatBytes(db.size_bytes)}</span>
                <span>{db.table_count} tablo</span>

                <button
                  onClick={() => setConfirmDelete(db.name)}
                  className="opacity-0 group-hover:opacity-100 transition-opacity text-destructive hover:text-destructive/80"
                  title="Sil"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>

                <Link to={`/databases/${db.name}`}>
                  <ChevronRight className="h-4 w-4" />
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Silme onayı */}
      {confirmDelete && (
        <Dialog open onOpenChange={() => setConfirmDelete(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Veritabanını sil</DialogTitle>
              <DialogDescription>
                <strong>{confirmDelete}</strong> veritabanı kalıcı olarak
                silinecek. Bu işlem geri alınamaz.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmDelete(null)}>
                İptal
              </Button>
              <Button
                variant="destructive"
                disabled={deleteDb.isPending}
                onClick={() =>
                  deleteDb.mutate(confirmDelete, {
                    onSuccess: () => setConfirmDelete(null),
                  })
                }
              >
                {deleteDb.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4" />
                )}
                Evet, sil
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* API Key Modal — DB oluşturulunca açılır */}
      {createdApiKey && (
        <ApiKeyModal
          dbName={createdApiKey.dbName}
          apiKey={createdApiKey.key}
          onClose={() => setCreatedApiKey(null)}
        />
      )}
    </div>
  );
}