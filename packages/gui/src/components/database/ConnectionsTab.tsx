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
import type { IpAllowlistConfig } from "../../lib/api.js";

// ── IP format validasyonu ──────────────────────────────────────────────────────

const IPV4_RE   = /^(\d{1,3}\.){3}\d{1,3}$/;
const IPV4C_RE  = /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/;
const IPV6_RE   = /^[0-9a-fA-F:]+$/;
const IPV6C_RE  = /^[0-9a-fA-F:]+\/\d{1,3}$/;

function isValidIpOrCidr(value: string): boolean {
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
] as const;

type Mode = (typeof MODES)[number]["id"];

// ── Ana bileşen ───────────────────────────────────────────────────────────────

export function ConnectionsTab({ db }: { db: string }) {
  const { data, isLoading, error } = useIpAllowlist(db);
  const { mutateAsync: saveAllowlist, isPending: saving } = useSetIpAllowlist(db);
  const { mutateAsync: resetAllowlist, isPending: resetting } = useResetIpAllowlist(db);
  const { success: toastSuccess, error: toastError } = useToast();

  const [mode, setMode]   = useState<Mode>("everyone");
  const [ips, setIps]     = useState<string[]>([]);
  const [input, setInput] = useState("");
  const [dirty, setDirty] = useState(false);

  // Sunucudan gelen veriyi yükle
  useEffect(() => {
    if (!data) return;
    setMode((data.mode as Mode) ?? "everyone");
    setIps(data.ips ?? []);
    setDirty(false);
  }, [data]);

  function handleModeChange(next: Mode) {
    setMode(next);
    setDirty(true);
  }

  function addIp() {
    const val = input.trim();
    if (!val) return;
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

  function removeIp(ip: string) {
    setIps((prev) => prev.filter((x) => x !== ip));
    setDirty(true);
  }

  async function handleSave() {
    if (mode === "allowlist" && ips.length === 0) {
      toastError("IP listesi boş — en az bir IP veya CIDR ekleyiniz.");
      return;
    }
    const config: IpAllowlistConfig = { mode, ips: mode === "allowlist" ? ips : [] };
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
    if (!data) return;
    setMode((data.mode as Mode) ?? "everyone");
    setIps(data.ips ?? []);
    setInput("");
    setDirty(false);
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full overflow-y-auto p-6">
        <div className="mx-auto max-w-lg">
          <div className="rounded border border-red-900/40 bg-card p-4">
            <p className="text-xs text-red-400">Erişim ayarları yüklenemedi.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mx-auto max-w-lg space-y-6">
        <h2 className="text-sm font-semibold">Bağlantı Erişim Kontrolü</h2>

        {/* Mod seçimi */}
        <div className="rounded border border-border bg-card p-4">
          <p className="mb-3 text-xs font-medium text-muted-foreground">Erişim Modu</p>
          <div className="space-y-2">
            {MODES.map(({ id, label, desc, Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => handleModeChange(id)}
                className={cn(
                  "flex w-full items-start gap-3 rounded px-3 py-2.5 text-left transition-colors",
                  mode === id
                    ? "bg-primary/10 text-foreground"
                    : "text-muted-foreground hover:bg-muted/40"
                )}
              >
                <Icon
                  className={cn(
                    "mt-0.5 h-4 w-4 shrink-0",
                    mode === id ? "text-primary" : "text-muted-foreground"
                  )}
                />
                <div className="min-w-0 flex-1">
                  <p
                    className={cn(
                      "text-xs font-medium",
                      mode === id ? "text-foreground" : "text-muted-foreground"
                    )}
                  >
                    {label}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{desc}</p>
                </div>
                <div
                  className={cn(
                    "mt-1 h-3.5 w-3.5 shrink-0 rounded-full border",
                    mode === id
                      ? "border-primary bg-primary"
                      : "border-border bg-transparent"
                  )}
                />
              </button>
            ))}
          </div>
        </div>

        {/* IP listesi — yalnızca allowlist modunda */}
        {mode === "allowlist" && (
          <div className="rounded border border-border bg-card p-4">
            <p className="mb-3 text-xs font-medium text-muted-foreground">
              İzin Verilen IP / CIDR Listesi
            </p>

            {/* Giriş alanı */}
            <div className="mb-3 flex gap-2">
              <Input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addIp()}
                placeholder="192.168.1.0/24 veya 10.0.0.1"
                className="h-8 flex-1 text-xs font-mono"
              />
              <Button
                size="sm"
                variant="outline"
                onClick={addIp}
                className="h-8 gap-1.5 text-xs"
              >
                <Plus className="h-3.5 w-3.5" />
                Ekle
              </Button>
            </div>

            {/* Liste */}
            {ips.length === 0 ? (
              <div className="flex items-center gap-2 rounded border border-dashed border-border/60 px-3 py-3">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-yellow-500" />
                <p className="text-xs text-muted-foreground">
                  Liste boş — kaydetmeden önce en az bir IP ekleyin.
                </p>
              </div>
            ) : (
              <div className="space-y-1">
                {ips.map((ip, idx, arr) => (
                  <div
                    key={ip}
                    className={cn(
                      "flex items-center justify-between py-1.5 text-xs",
                      idx !== arr.length - 1 && "border-b border-border/40"
                    )}
                  >
                    <span className="font-mono text-foreground">{ip}</span>
                    <button
                      type="button"
                      onClick={() => removeIp(ip)}
                      className="rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Mevcut durum bilgisi */}
        {!dirty && data && (
          <div className="rounded border border-border bg-card p-4">
            <p className="mb-3 text-xs font-medium text-muted-foreground">Mevcut Ayar</p>
            <div className="space-y-2 text-xs text-muted-foreground">
              <div className="flex justify-between border-b border-border/40 pb-2">
                <span>Mod</span>
                <span className="font-mono text-foreground">{data.mode}</span>
              </div>
              <div className="flex justify-between">
                <span>İzin verilen kural sayısı</span>
                <span className="font-mono text-foreground">{data.ips?.length ?? 0}</span>
              </div>
            </div>
          </div>
        )}

        {/* Aksiyon butonları */}
        <div className="flex gap-2">
          {dirty ? (
            <>
              <Button
                size="sm"
                onClick={handleSave}
                disabled={saving}
                className="gap-1.5 text-xs"
              >
                {saving ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Shield className="h-3.5 w-3.5" />
                )}
                Kaydet
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={handleDiscard}
                disabled={saving}
                className="text-xs"
              >
                İptal
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              variant="outline"
              onClick={handleReset}
              disabled={resetting}
              className="gap-1.5 text-xs"
            >
              {resetting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : null}
              Herkese Aç
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}