import { useState, useRef, useCallback, useEffect } from "react";
import {
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
  Copy,
  Check,
  Search,
  X,
} from "lucide-react";

export interface Column {
  key: string;
  label: string;
  sortable?: boolean;
  width?: number;
  minWidth?: number;
  render?: (value: unknown, row: Record<string, unknown>) => React.ReactNode;
}

export interface DataGridProps {
  columns: Column[];
  rows: Record<string, unknown>[];
  isLoading?: boolean;
  emptyMessage?: string;
  onSort?: (key: string, direction: "asc" | "desc") => void;
  sortKey?: string;
  sortDirection?: "asc" | "desc";
  /** Highlight cells matching this text */
  highlightText?: string;
}

type SortDir = "asc" | "desc" | null;

function CellValue({
  value,
  highlight,
}: {
  value: unknown;
  highlight?: string;
}) {
  const [copied, setCopied] = useState(false);

  const display =
    value === null || value === undefined
      ? null
      : typeof value === "object"
      ? JSON.stringify(value)
      : String(value);

  const handleCopy = useCallback(async () => {
    if (display === null) return;
    await navigator.clipboard.writeText(display);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [display]);

  if (display === null) {
    return <span className="text-slate-600 italic text-xs">NULL</span>;
  }

  // Highlight matching text
  if (highlight && display.toLowerCase().includes(highlight.toLowerCase())) {
    const idx = display.toLowerCase().indexOf(highlight.toLowerCase());
    return (
      <span className="group/cell flex items-center gap-1 min-w-0">
        <span className="truncate">
          {display.slice(0, idx)}
          <mark className="bg-yellow-400/30 text-yellow-200 rounded px-0.5">
            {display.slice(idx, idx + highlight.length)}
          </mark>
          {display.slice(idx + highlight.length)}
        </span>
        <button
          onClick={handleCopy}
          className="opacity-0 group-hover/cell:opacity-100 flex-shrink-0 p-0.5 text-slate-500 hover:text-slate-300 transition-all"
          title="Copy"
        >
          {copied ? (
            <Check className="w-3 h-3 text-green-400" />
          ) : (
            <Copy className="w-3 h-3" />
          )}
        </button>
      </span>
    );
  }

  return (
    <span className="group/cell flex items-center gap-1 min-w-0">
      <span className="truncate">{display}</span>
      <button
        onClick={handleCopy}
        className="opacity-0 group-hover/cell:opacity-100 flex-shrink-0 p-0.5 text-slate-500 hover:text-slate-300 transition-all"
        title="Copy"
      >
        {copied ? (
          <Check className="w-3 h-3 text-green-400" />
        ) : (
          <Copy className="w-3 h-3" />
        )}
      </button>
    </span>
  );
}

export function DataGrid({
  columns,
  rows,
  isLoading,
  emptyMessage = "No data found.",
  onSort,
  sortKey,
  sortDirection,
  highlightText,
}: DataGridProps) {
  const [internalSort, setInternalSort] = useState<{
    key: string;
    dir: SortDir;
  }>({ key: "", dir: null });
  const [search, setSearch] = useState("");
  const [colWidths, setColWidths] = useState<Record<string, number>>({});
  const resizeRef = useRef<{
    colKey: string;
    startX: number;
    startWidth: number;
  } | null>(null);

  // Column resize handlers
  const onResizeStart = useCallback(
    (e: React.MouseEvent, colKey: string, currentWidth: number) => {
      e.preventDefault();
      resizeRef.current = {
        colKey,
        startX: e.clientX,
        startWidth: currentWidth,
      };

      const onMouseMove = (ev: MouseEvent) => {
        if (!resizeRef.current) return;
        const delta = ev.clientX - resizeRef.current.startX;
        const newWidth = Math.max(
          60,
          resizeRef.current.startWidth + delta
        );
        setColWidths((prev) => ({
          ...prev,
          [resizeRef.current!.colKey]: newWidth,
        }));
      };

      const onMouseUp = () => {
        resizeRef.current = null;
        window.removeEventListener("mousemove", onMouseMove);
        window.removeEventListener("mouseup", onMouseUp);
      };

      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup", onMouseUp);
    },
    []
  );

  const handleSort = useCallback(
    (colKey: string) => {
      if (onSort) {
        const newDir =
          sortKey === colKey && sortDirection === "asc" ? "desc" : "asc";
        onSort(colKey, newDir);
      } else {
        setInternalSort((prev) => {
          if (prev.key !== colKey) return { key: colKey, dir: "asc" };
          if (prev.dir === "asc") return { key: colKey, dir: "desc" };
          return { key: "", dir: null };
        });
      }
    },
    [onSort, sortKey, sortDirection]
  );

  const effectiveSortKey = onSort ? sortKey ?? "" : internalSort.key;
  const effectiveSortDir = onSort ? sortDirection ?? null : internalSort.dir;

  // Client-side sort + filter when no external handler
  const processedRows = (() => {
    let result = rows;

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter((row) =>
        Object.values(row).some((v) =>
          v !== null && v !== undefined
            ? String(v).toLowerCase().includes(q)
            : false
        )
      );
    }

    if (!onSort && effectiveSortKey && effectiveSortDir) {
      result = [...result].sort((a, b) => {
        const av = a[effectiveSortKey];
        const bv = b[effectiveSortKey];
        if (av === null || av === undefined) return 1;
        if (bv === null || bv === undefined) return -1;
        const cmp = String(av).localeCompare(String(bv), undefined, {
          numeric: true,
        });
        return effectiveSortDir === "asc" ? cmp : -cmp;
      });
    }

    return result;
  })();

  const highlight = highlightText || (search.trim() ? search : undefined);

  return (
    <div className="flex flex-col h-full">
      {/* Search bar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-700/50">
        <Search className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search in results..."
          className="flex-1 bg-transparent text-sm text-slate-300 placeholder-slate-600 outline-none"
        />
        {search && (
          <button onClick={() => setSearch("")} className="text-slate-500 hover:text-slate-300">
            <X className="w-3.5 h-3.5" />
          </button>
        )}
        <span className="text-xs text-slate-600">
          {processedRows.length} / {rows.length} rows
        </span>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-sm border-collapse min-w-max">
          <thead className="sticky top-0 z-10">
            <tr className="bg-slate-800/90 backdrop-blur-sm">
              {columns.map((col) => {
                const width = colWidths[col.key] ?? col.width;
                const isSorted = effectiveSortKey === col.key;

                return (
                  <th
                    key={col.key}
                    className="relative px-3 py-2 text-left text-xs font-medium text-slate-400 border-b border-r border-slate-700/50 select-none whitespace-nowrap group/th"
                    style={{ width, minWidth: col.minWidth ?? 60 }}
                  >
                    <div className="flex items-center gap-1">
                      {col.sortable !== false ? (
                        <button
                          onClick={() => handleSort(col.key)}
                          className="flex items-center gap-1 hover:text-slate-200 transition-colors"
                        >
                          {col.label}
                          {isSorted ? (
                            effectiveSortDir === "asc" ? (
                              <ChevronUp className="w-3 h-3 text-blue-400" />
                            ) : (
                              <ChevronDown className="w-3 h-3 text-blue-400" />
                            )
                          ) : (
                            <ChevronsUpDown className="w-3 h-3 opacity-0 group-hover/th:opacity-50" />
                          )}
                        </button>
                      ) : (
                        col.label
                      )}
                    </div>

                    {/* Resize handle */}
                    <div
                      onMouseDown={(e) =>
                        onResizeStart(e, col.key, width ?? 120)
                      }
                      className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize opacity-0 group-hover/th:opacity-100 hover:bg-blue-500/50 transition-all"
                    />
                  </th>
                );
              })}
            </tr>
          </thead>

          <tbody>
            {isLoading ? (
              Array.from({ length: 8 }).map((_, i) => (
                <tr key={i} className="border-b border-slate-800/50">
                  {columns.map((col) => (
                    <td key={col.key} className="px-3 py-2">
                      <div className="h-3.5 bg-slate-700/50 rounded animate-pulse" />
                    </td>
                  ))}
                </tr>
              ))
            ) : processedRows.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-3 py-12 text-center text-slate-500"
                >
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              processedRows.map((row, rowIdx) => (
                <tr
                  key={rowIdx}
                  className="border-b border-slate-800/50 hover:bg-slate-800/30 transition-colors group"
                >
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      className="px-3 py-1.5 text-slate-300 border-r border-slate-800/50 max-w-xs"
                    >
                      {col.render ? (
                        col.render(row[col.key], row)
                      ) : (
                        <CellValue value={row[col.key]} highlight={highlight} />
                      )}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}