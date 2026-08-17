import { useState } from "react";
import { Clock, ChevronRight, Trash2, Search, X } from "lucide-react";

export interface HistoryEntry {
  id: string;
  sql: string;
  executedAt: Date;
  duration?: number;
  rowCount?: number;
  error?: boolean;
}

interface QueryHistoryProps {
  entries: HistoryEntry[];
  onSelect: (sql: string) => void;
  onClear?: () => void;
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/**
 * Query history panel — lists previously executed queries.
 */
export function QueryHistory({
  entries,
  onSelect,
  onClear,
}: QueryHistoryProps) {
  const [search, setSearch] = useState("");

  const filtered = search.trim()
    ? entries.filter((e) =>
        e.sql.toLowerCase().includes(search.toLowerCase())
      )
    : entries;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-700/50">
        <div className="flex items-center gap-1.5">
          <Clock className="w-3.5 h-3.5 text-slate-500" />
          <span className="text-xs font-medium text-slate-400">History</span>
          <span className="text-xs text-slate-600">({filtered.length})</span>
        </div>
        {onClear && entries.length > 0 && (
          <button
            onClick={onClear}
            className="flex items-center gap-1 text-xs text-slate-500 hover:text-red-400 transition-colors"
          >
            <Trash2 className="w-3 h-3" />
            Clear
          </button>
        )}
      </div>

      {/* Search */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-slate-700/50">
        <Search className="w-3 h-3 text-slate-600 flex-shrink-0" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search history..."
          className="flex-1 bg-transparent text-xs text-slate-400 placeholder-slate-600 outline-none"
        />
        {search && (
          <button onClick={() => setSearch("")} className="text-slate-600 hover:text-slate-400">
            <X className="w-3 h-3" />
          </button>
        )}
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <Clock className="w-8 h-8 text-slate-700 mb-2" />
            <p className="text-xs text-slate-600">
              {entries.length === 0
                ? "No queries executed yet."
                : "No results found."}
            </p>
          </div>
        ) : (
          filtered.map((entry) => (
            <button
              key={entry.id}
              onClick={() => onSelect(entry.sql)}
              className="w-full text-left px-3 py-2 hover:bg-slate-800/50 border-b border-slate-800/50 group transition-colors"
            >
              <div className="flex items-start gap-2">
                <ChevronRight className="w-3 h-3 text-slate-600 flex-shrink-0 mt-0.5 group-hover:text-blue-400 transition-colors" />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-mono text-slate-300 truncate group-hover:text-slate-100 transition-colors">
                    {entry.sql.replace(/\s+/g, " ").trim()}
                  </p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-xs text-slate-600">
                      {formatTime(entry.executedAt)}
                    </span>
                    {entry.duration !== undefined && (
                      <span className="text-xs text-slate-600">
                        {entry.duration}ms
                      </span>
                    )}
                    {entry.rowCount !== undefined && (
                      <span className="text-xs text-slate-600">
                        {entry.rowCount} rows
                      </span>
                    )}
                    {entry.error && (
                      <span className="text-xs text-red-400">Error</span>
                    )}
                  </div>
                </div>
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
}