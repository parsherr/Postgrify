/**
 * BottomPanel — Quick SQL editörü, tam genişlikte, AppShell'in altında.
 * ResizableHandle ile yukarı sürükleyerek açılır/büyütülür.
 * Varsayılan: kapalı (collapsedSize). Drag ile açılır.
 */

import React from "react";
import { Terminal, X, Play, ChevronUp } from "lucide-react";
import { ResizableHandle, ResizablePanel } from "@/components/ui/resizable";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useNavigate } from "react-router-dom";

const PANEL_STORAGE_KEY = "postgrify_bottom_panel_size";

interface QuickResult {
  rows: Record<string, unknown>[];
  count?: number;
}

export function SidebarBottomPanel() {
  const navigate = useNavigate();
  const [sql, setSql] = React.useState("SELECT 1;");
  const [result, setResult] = React.useState<QuickResult | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [isRunning, setIsRunning] = React.useState(false);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  const savedSize = React.useMemo(() => {
    const raw = localStorage.getItem(PANEL_STORAGE_KEY);
    const parsed = raw ? parseInt(raw, 10) : NaN;
    return isNaN(parsed) ? 32 : parsed; // 32px = kapalı (sadece header)
  }, []);

  async function runQuickSql() {
    if (!sql.trim() || isRunning) return;
    setIsRunning(true);
    setError(null);
    setResult(null);
    try {
      const token = localStorage.getItem("postgrify_token");
      // Token'dan DB'yi parse et (JWT payload)
      let db = "";
      if (token) {
        try {
          const payload = JSON.parse(atob(token.split(".")[1]));
          db = payload.database ?? payload.db ?? "";
        } catch { /* ignore */ }
      }
      if (!db) {
        setError("Önce bir veritabanı seçin");
        return;
      }
      const res = await fetch(
        `${(import.meta as unknown as { env: { VITE_API_URL?: string } }).env.VITE_API_URL ?? "http://localhost:3000"}/db/${db}/query`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ sql }),
        }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
        setError(err.error ?? res.statusText);
        return;
      }
      const data = await res.json() as QuickResult;
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsRunning(false);
    }
  }

  function openInEditor() {
    navigate("/query", { state: { initialSql: sql } });
  }

  return (
    <>
      {/* Drag handle — sürükleyince panel büyür */}
      <ResizableHandle
        withHandle
        className="group border-t border-border"
      />

      {/* Bottom panel — collapsible */}
      <ResizablePanel
        id="bottom-panel"
        defaultSize={`${savedSize}px`}
        minSize="32px"
        maxSize="60%"
        collapsible
        collapsedSize="32px"
        className="flex flex-col border-t border-border bg-card"
      >
        {/* Header — her zaman görünür */}
        <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border/50 px-3">
          <Terminal className="h-3.5 w-3.5 text-muted-foreground/60" />
          <span className="text-xs font-medium text-muted-foreground">Quick SQL</span>
          <div className="flex-1" />
          <button
            onClick={openInEditor}
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-2xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            title="Editörde Aç"
          >
            <ChevronUp className="h-3 w-3" />
            Editörde Aç
          </button>
        </div>

        {/* İçerik — panel açıkken görünür */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {/* Editör alanı */}
          <div className="flex min-h-0 flex-1 overflow-hidden">
            <textarea
              ref={textareaRef}
              value={sql}
              onChange={(e) => setSql(e.target.value)}
              onKeyDown={(e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                  e.preventDefault();
                  runQuickSql();
                }
              }}
              spellCheck={false}
              className={cn(
                "flex-1 resize-none bg-transparent p-3 font-mono text-xs text-foreground",
                "placeholder:text-muted-foreground/40 focus:outline-none"
              )}
              placeholder="SELECT * FROM users LIMIT 10;"
            />

            {/* Çalıştır butonu */}
            <div className="flex shrink-0 flex-col gap-2 border-l border-border/50 p-2">
              <Button
                size="sm"
                onClick={runQuickSql}
                disabled={!sql.trim() || isRunning}
                className="h-7 gap-1 px-2 text-xs"
              >
                <Play className="h-3 w-3" />
                {isRunning ? "…" : "Çalıştır"}
              </Button>
            </div>
          </div>

          {/* Sonuç alanı */}
          {(result || error) && (
            <div className="max-h-32 overflow-y-auto border-t border-border/50">
              {error ? (
                <div className="flex items-start gap-2 p-2">
                  <X className="mt-0.5 h-3 w-3 shrink-0 text-red-400" />
                  <span className="font-mono text-xs text-red-400">{error}</span>
                </div>
              ) : result && result.rows.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border/40">
                        {Object.keys(result.rows[0]).map((col) => (
                          <th key={col} className="px-3 py-1 text-left font-mono text-2xs text-muted-foreground/60">
                            {col}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {result.rows.slice(0, 5).map((row, i) => (
                        <tr key={i} className="border-b border-border/20 hover:bg-accent/10">
                          {Object.values(row).map((val, j) => (
                            <td key={j} className="px-3 py-1 font-mono text-xs text-foreground/80">
                              {val === null ? (
                                <span className="text-muted-foreground/40">null</span>
                              ) : (
                                String(val)
                              )}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {result.rows.length > 5 && (
                    <div className="px-3 py-1 text-2xs text-muted-foreground/50">
                      +{result.rows.length - 5} satır daha — editörde aç
                    </div>
                  )}
                </div>
              ) : (
                <div className="px-3 py-2 text-xs text-muted-foreground">
                  {result?.count ?? 0} satır döndü
                </div>
              )}
            </div>
          )}
        </div>
      </ResizablePanel>
    </>
  );
}