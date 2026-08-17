/**
 * ConnectionsTab — Per-database IP access control.
 *
 * Three modes:
 *   everyone     — Open to all (default)
 *   same_network — Devices on the same network as the server (/24 subnet)
 *   allowlist    — Only specified IP/CIDR addresses
 *
 * URL: /databases/:db?tab=connections
 * Design: same style as OptionsTab (max-w-lg, bg-card cards, text-xs content)
 */

import { useState, useEffect } from "react";
import { Shield, Globe, Network, Lock, Plus, X, Loader2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/Toast";
import { cn } from "@/lib/utils";
import { useIpAllowlist, useSetIpAllowlist, useResetIpAllowlist } from "../../hooks/useIpAllowlist.js";
import type { IpAllowlistConfig } from "../../lib/api.js";

// ── IP format validation ───────────────────────────────────────────────────────

const IPV4_RE   = /^(\d{1,3}\.){3}\d{1,3}$/;
const IPV4C_RE  = /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/;
const IPV6_RE   = /^[0-9a-fA-F:]+$/;
const IPV6C_RE  = /^[0-9a-fA-F:]+\/\d{1,3}$/;

function isValidIpOrCidr(value: string): boolean {
  const v = value.trim();
  return IPV4_RE.test(v) || IPV4C_RE.test(v) || IPV6_RE.test(v) || IPV6C_RE.test(v);
}

// ── Mode descriptions ──────────────────────────────────────────────────────────

const MODES = [
  {
    id: "everyone",
    label: "Open to All",
    desc: "All IP addresses are allowed to connect.",
    Icon: Globe,
  },
  {
    id: "same_network",
    label: "Same Network",
    desc: "Only devices on the same local network as the server (/24 subnet) can connect.",
    Icon: Network,
  },
  {
    id: "allowlist",
    label: "IP Allowlist",
    desc: "Only the specified IP addresses or CIDR blocks are allowed.",
    Icon: Lock,
  },
] as const;

type Mode = (typeof MODES)[number]["id"];

// ── Main component ─────────────────────────────────────────────────────────────

export function ConnectionsTab({ db }: { db: string }) {
  const { data, isLoading, error } = useIpAllowlist(db);
  const { mutateAsync: saveAllowlist, isPending: saving } = useSetIpAllowlist(db);
  const { mutateAsync: resetAllowlist, isPending: resetting } = useResetIpAllowlist(db);
  const { success: toastSuccess, error: toastError } = useToast();

  const [mode, setMode]   = useState<Mode>("everyone");
  const [ips, setIps]     = useState<string[]>([]);
  const [input, setInput] = useState("");
  const [dirty, setDirty] = useState(false);

  // Load data from server
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
      toastError("Invalid format: enter an IPv4, IPv6, or CIDR address.");
      return;
    }
    if (ips.includes(val)) {
      toastError(`${val} is already in the list.`);
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
      toastError("IP list is empty — add at least one IP or CIDR.");
      return;
    }
    const config: IpAllowlistConfig = { mode, ips: mode === "allowlist" ? ips : [] };
    await saveAllowlist(config);
    setDirty(false);
    toastSuccess("Access settings updated.");
  }

  async function handleReset() {
    await resetAllowlist();
    setMode("everyone");
    setIps([]);
    setDirty(false);
    toastSuccess("Access settings reset to default.");
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
            <p className="text-xs text-red-400">Failed to load access settings.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mx-auto max-w-lg space-y-6">
        <h2 className="text-sm font-semibold">Connection Access Control</h2>

        {/* Mode selection */}
        <div className="rounded border border-border bg-card p-4">
          <p className="mb-3 text-xs font-medium text-muted-foreground">Access Mode</p>
          <div className="space-y-2">
            {MODES.map(({ id, label, desc, Icon }) => (
              <button
                key={id}
                onClick={() => handleModeChange(id)}
                className={cn(
                  "flex w-full items-start gap-3 rounded border p-3 text-left transition-colors",
                  mode === id
                    ? "border-zinc-600 bg-zinc-800/60"
                    : "border-border hover:border-zinc-700 hover:bg-zinc-800/30"
                )}
              >
                <Icon
                  className={cn(
                    "mt-0.5 h-4 w-4 shrink-0",
                    mode === id ? "text-foreground" : "text-muted-foreground"
                  )}
                />
                <div>
                  <p
                    className={cn(
                      "text-xs font-medium",
                      mode === id ? "text-foreground" : "text-muted-foreground"
                    )}
                  >
                    {label}
                  </p>
                  <p className="mt-0.5 text-2xs text-muted-foreground/70">{desc}</p>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* IP list — shown only when allowlist mode is active */}
        {mode === "allowlist" && (
          <div className="rounded border border-border bg-card p-4">
            <p className="mb-3 text-xs font-medium text-muted-foreground">Allowed IPs</p>

            {/* Add input */}
            <div className="mb-3 flex gap-2">
              <Input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addIp()}
                placeholder="192.168.1.1 or 10.0.0.0/8"
                className="h-7 text-xs"
              />
              <Button
                size="sm"
                variant="outline"
                onClick={addIp}
                className="h-7 gap-1 text-xs"
              >
                <Plus className="h-3 w-3" />
                Add
              </Button>
            </div>

            {/* IP list */}
            {ips.length === 0 ? (
              <div className="flex items-center gap-2 rounded border border-dashed border-border p-3 text-xs text-muted-foreground">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                No IPs added yet. All connections will be blocked.
              </div>
            ) : (
              <div className="space-y-1.5">
                {ips.map((ip) => (
                  <div
                    key={ip}
                    className="flex items-center justify-between rounded border border-border bg-background px-3 py-1.5"
                  >
                    <span className="font-mono text-xs">{ip}</span>
                    <button
                      onClick={() => removeIp(ip)}
                      className="text-muted-foreground/50 transition-colors hover:text-red-400"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Current config summary (read-only, clean state) */}
        {!dirty && data && (
          <div className="rounded border border-border bg-card p-4">
            <p className="mb-2 text-xs font-medium text-muted-foreground">Current Config</p>
            <div className="space-y-2 text-xs text-muted-foreground">
              <div className="flex justify-between border-b border-border/40 pb-2">
                <span>Mode</span>
                <span className="font-mono text-foreground">{data.mode}</span>
              </div>
              <div className="flex justify-between">
                <span>Allowed rules count</span>
                <span className="font-mono text-foreground">{data.ips?.length ?? 0}</span>
              </div>
            </div>
          </div>
        )}

        {/* Action buttons */}
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
                Save
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={handleDiscard}
                disabled={saving}
                className="text-xs"
              >
                Cancel
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
              Open to All
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}