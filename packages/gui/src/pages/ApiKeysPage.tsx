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
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

const SCOPES = ["read", "write", "delete", "schema", "query"] as const;
type Scope = (typeof SCOPES)[number];

const SCOPE_COLORS: Record<Scope, string> = {
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

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = React.useState(false);
  function copy() {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }
  return (
    <button
      onClick={copy}
      className="flex items-center gap-1 rounded px-2 py-1 text-2xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
    >
      {copied ? (
        <Check className="h-3 w-3 text-green-500" />
      ) : (
        <Copy className="h-3 w-3" />
      )}
      {copied ? "Kopyalandı" : "Kopyala"}
    </button>
  );
}

export default function ApiKeysPage() {
  const { data: databases } = useDatabases();
  const { mutateAsync: createToken, isPending: creating } = useDbToken();

  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [newToken, setNewToken] = React.useState<string | null>(null);

  // Form state
  const [formDb, setFormDb] = React.useState<string>("");
  const [formSecret, setFormSecret] = React.useState<string>("");
  const [formScopes, setFormScopes] = React.useState<Scope[]>(["read"]);
  const [formExpiry, setFormExpiry] = React.useState("30d");
  const [formError, setFormError] = React.useState<string | null>(null);

  function toggleScope(scope: Scope) {
    setFormScopes((prev) =>
      prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope]
    );
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
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Oluşturulamadı");
    }
  }

  return (
    <div className="flex h-full flex-col gap-6 overflow-y-auto p-6">
      {/* Başlık */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-base font-semibold text-foreground">API Keys</h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Veritabanı bazlı JWT token'ları oluştur
          </p>
        </div>
        <Button size="sm" onClick={openDrawer} className="gap-1.5">
          <Plus className="h-3.5 w-3.5" />
          Token Oluştur
        </Button>
      </div>

      {/* Bilgi kartı */}
      <div className="rounded border border-border bg-card p-4">
        <div className="flex items-start gap-3">
          <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/50" />
          <div className="space-y-1">
            <p className="text-xs font-medium text-foreground">Token Yapısı</p>
            <p className="text-xs text-muted-foreground">
              Her token tek bir veritabanına ve belirli scope'lara (izinlere) bağlıdır.
              Token'lar JWT formatında imzalanır ve yalnızca oluşturulduğu anda görüntülenir.
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {SCOPES.map((scope) => (
                <span
                  key={scope}
                  className={cn(
                    "inline-flex items-center rounded-sm border px-1.5 py-0.5 font-mono text-2xs",
                    SCOPE_COLORS[scope]
                  )}
                >
                  {scope}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Token geçmişi (local) */}
      <TokenHistory />

      {/* Token oluşturma sheet */}
      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
        <SheetContent side="right" className="flex w-96 flex-col gap-0 p-0">
          <SheetHeader className="border-b border-border px-6 py-4">
            <SheetTitle>Token Oluştur</SheetTitle>
            <SheetDescription>
              Veritabanı erişim token'ı oluşturur. Token yalnızca bir kez gösterilir.
            </SheetDescription>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto px-6 py-4">
            {newToken ? (
              <div className="space-y-4">
                <div className="rounded border border-green-900/50 bg-green-950/30 p-4">
                  <p className="mb-2 text-xs font-medium text-green-400">
                    Token oluşturuldu!
                  </p>
                  <p className="mb-3 text-2xs text-muted-foreground">
                    Bu token yalnızca şu an görünür. Kopyalayın ve güvende saklayın.
                  </p>
                  <div className="flex items-start gap-2 rounded border border-border bg-background p-3">
                    <code className="flex-1 break-all font-mono text-2xs text-foreground">
                      {newToken}
                    </code>
                  </div>
                  <div className="mt-2">
                    <CopyButton value={newToken} />
                  </div>
                </div>
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => {
                    // Geçmişe kaydet
                    addToLocalHistory({ db: formDb, scopes: formScopes, expiry: formExpiry, token: newToken });
                    setNewToken(null);
                    setDrawerOpen(false);
                  }}
                >
                  Kapat
                </Button>
              </div>
            ) : (
              <div className="space-y-5">
                <div className="space-y-1.5">
                  <Label>Veritabanı</Label>
                  <Select value={formDb} onValueChange={setFormDb}>
                    <SelectTrigger className="text-xs">
                      <SelectValue placeholder="Veritabanı seçin…" />
                    </SelectTrigger>
                    <SelectContent>
                      {databases?.map((db) => (
                        <SelectItem key={db.name} value={db.name} className="font-mono text-xs">
                          {db.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label>DB Secret</Label>
                  <Input
                    type="password"
                    value={formSecret}
                    onChange={(e) => setFormSecret(e.target.value)}
                    placeholder="DB_SECRET_xxx veya ADMIN_SECRET"
                    className="font-mono text-xs"
                  />
                  <p className="text-2xs text-muted-foreground">
                    {"Env'deki DB_SECRET_<DB> veya ADMIN_SECRET"}
                  </p>
                </div>

                <div className="space-y-2">
                  <Label>İzinler (Scope)</Label>
                  <div className="flex flex-wrap gap-2">
                    {SCOPES.map((scope) => {
                      const active = formScopes.includes(scope);
                      return (
                        <button
                          key={scope}
                          type="button"
                          onClick={() => toggleScope(scope)}
                          className={cn(
                            "rounded-sm border px-2.5 py-1 font-mono text-xs transition-all",
                            active
                              ? SCOPE_COLORS[scope]
                              : "border-border text-muted-foreground hover:border-zinc-600 hover:text-foreground"
                          )}
                        >
                          {scope}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label>Geçerlilik Süresi</Label>
                  <Select value={formExpiry} onValueChange={setFormExpiry}>
                    <SelectTrigger className="text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {EXPIRY_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value} className="text-xs">
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {formError && (
                  <div className="rounded border border-red-900/50 bg-red-950/30 px-3 py-2">
                    <p className="text-xs text-red-400">{formError}</p>
                  </div>
                )}
              </div>
            )}
          </div>

          {!newToken && (
            <SheetFooter className="border-t border-border px-6 py-4">
              <Button variant="ghost" onClick={() => setDrawerOpen(false)}>
                İptal
              </Button>
              <Button onClick={handleCreate} disabled={creating}>
                {creating ? (
                  <>
                    <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                    Oluşturuluyor…
                  </>
                ) : (
                  "Token Oluştur"
                )}
              </Button>
            </SheetFooter>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

// --- Local history (token'ları kopyalamak için) ---

interface LocalTokenEntry {
  db: string;
  scopes: string[];
  expiry: string;
  token: string;
  ts: number;
}

const LOCAL_TOKENS_KEY = "postgrify_local_tokens";

function addToLocalHistory(entry: Omit<LocalTokenEntry, "ts">) {
  const existing: LocalTokenEntry[] = JSON.parse(localStorage.getItem(LOCAL_TOKENS_KEY) ?? "[]");
  existing.unshift({ ...entry, ts: Date.now() });
  localStorage.setItem(LOCAL_TOKENS_KEY, JSON.stringify(existing.slice(0, 20)));
}

function TokenHistory() {
  const [tokens, setTokens] = React.useState<LocalTokenEntry[]>([]);

  React.useEffect(() => {
    const raw = localStorage.getItem(LOCAL_TOKENS_KEY);
    if (raw) setTokens(JSON.parse(raw));
  }, []);

  if (tokens.length === 0) return null;

  function remove(idx: number) {
    const updated = tokens.filter((_, i) => i !== idx);
    setTokens(updated);
    localStorage.setItem(LOCAL_TOKENS_KEY, JSON.stringify(updated));
  }

  return (
    <div className="rounded border border-border">
      <div className="border-b border-border px-4 py-2.5">
        <span className="text-xs font-medium text-foreground">
          Oluşturulan Token'lar
        </span>
        <span className="ml-2 text-2xs text-muted-foreground">(bu cihazda kayıtlı)</span>
      </div>
      <div className="divide-y divide-border/40">
        {tokens.map((entry, i) => (
          <div key={i} className="group flex items-center gap-3 px-4 py-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm text-foreground">{entry.db}</span>
                <div className="flex gap-1">
                  {entry.scopes.map((s) => (
                    <span
                      key={s}
                      className={cn(
                        "inline-flex items-center rounded-sm border px-1 py-0.5 font-mono text-2xs",
                        SCOPE_COLORS[s as Scope] ?? "border-border text-muted-foreground"
                      )}
                    >
                      {s}
                    </span>
                  ))}
                </div>
              </div>
              <div className="mt-0.5 flex items-center gap-2">
                <code className="max-w-[240px] truncate font-mono text-2xs text-muted-foreground">
                  {entry.token}
                </code>
                <span className="text-2xs text-muted-foreground/40">{entry.expiry}</span>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <CopyButton value={entry.token} />
              <button
                onClick={() => remove(i)}
                className="rounded p-1 text-muted-foreground/30 opacity-0 transition-all group-hover:opacity-100 hover:text-red-400"
              >
                ×
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}