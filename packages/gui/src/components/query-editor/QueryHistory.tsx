/**
 * QueryHistory — son 20 sorgu, localStorage'da saklanır.
 */

import React from "react";
import { Clock, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const HISTORY_KEY = "postgrify_query_history";
const MAX_HISTORY = 20;

interface HistoryEntry {
  sql: string;
  db: string;
  ts: number;
}

export function loadHistory(): HistoryEntry[] {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]");
  } catch {
    return [];
  }
}

export function saveToHistory(entry: HistoryEntry) {
  const history = loadHistory().filter(
    (h) => h.sql !== entry.sql || h.db !== entry.db
  );
  history.unshift(entry);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, MAX_HISTORY)));
}

interface QueryHistoryProps {
  onSelect: (sql: string) => void;
}

export function QueryHistory({ onSelect }: QueryHistoryProps) {
  const [history, setHistory] = React.useState<HistoryEntry[]>(loadHistory);
  const [open, setOpen] = React.useState(false);

  function refresh() {
    setHistory(loadHistory());
  }

  function clearHistory() {
    localStorage.removeItem(HISTORY_KEY);
    setHistory([]);
  }

  function formatTs(ts: number) {
    const d = new Date(ts);
    const now = Date.now();
    const diff = Math.floor((now - ts) / 1000);
    if (diff < 60) return "az önce";
    if (diff < 3600) return `${Math.floor(diff / 60)} dk önce`;
    if (diff < 86400) return `${Math.floor(diff / 3600)} sa önce`;
    return d.toLocaleDateString("tr-TR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  }

  return (
    <DropdownMenu open={open} onOpenChange={(o) => { setOpen(o); if (o) refresh(); }}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-1.5 text-xs">
          <Clock className="h-3.5 w-3.5" />
          Geçmiş
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <div className="flex items-center justify-between">
          <DropdownMenuLabel>Sorgu Geçmişi</DropdownMenuLabel>
          {history.length > 0 && (
            <Button
              variant="ghost"
              size="icon-sm"
              className="mr-1 h-5 w-5 text-muted-foreground"
              onClick={clearHistory}
              title="Geçmişi temizle"
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          )}
        </div>
        <DropdownMenuSeparator />
        {history.length === 0 && (
          <div className="px-3 py-4 text-center text-xs text-muted-foreground">
            Henüz sorgu yok
          </div>
        )}
        <div className="max-h-64 overflow-y-auto">
          {history.map((entry, i) => (
            <button
              key={i}
              onClick={() => { onSelect(entry.sql); setOpen(false); }}
              className="flex w-full flex-col gap-0.5 px-3 py-2 text-left transition-colors hover:bg-accent"
            >
              <span className="block truncate font-mono text-xs text-foreground">
                {entry.sql.replace(/\s+/g, " ").trim()}
              </span>
              <div className="flex items-center gap-1.5">
                <span className="font-mono text-2xs text-muted-foreground/60">
                  {entry.db}
                </span>
                <span className="text-2xs text-muted-foreground/40">·</span>
                <span className="text-2xs text-muted-foreground/60">
                  {formatTs(entry.ts)}
                </span>
              </div>
            </button>
          ))}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}