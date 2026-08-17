import { useState } from "react";
import {
  CheckCircle,
  XCircle,
  Clock,
  Download,
  Copy,
  Check,
  Table,
  Code,
} from "lucide-react";
import { DataGrid, Column } from "../data-grid/DataGrid";

export interface QueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  duration: number;
  error?: string;
  command?: string;
}

interface ResultsPanelProps {
  result: QueryResult | null;
  isExecuting?: boolean;
}

type ViewMode = "table" | "raw";

/**
 * Displays query results as a data grid or raw JSON.
 */
export function ResultsPanel({ result, isExecuting }: ResultsPanelProps) {
  const [viewMode, setViewMode] = useState<ViewMode>("table");
  const [copied, setCopied] = useState(false);

  const handleCopyJson = async () => {
    if (!result) return;
    await navigator.clipboard.writeText(
      JSON.stringify(result.rows, null, 2)
    );
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleDownloadCsv = () => {
    if (!result) return;
    const header = result.columns.join(",");
    const body = result.rows
      .map((row) =>
        result.columns
          .map((col) => {
            const val = row[col];
            if (val === null || val === undefined) return "";
            const str = typeof val === "object" ? JSON.stringify(val) : String(val);
            return str.includes(",") || str.includes('"') || str.includes("\n")
              ? `"${str.replace(/"/g, '""')}"`
              : str;
          })
          .join(",")
      )
      .join("\n");
    const blob = new Blob([header + "\n" + body], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "query_result.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  if (isExecuting) {
    return (
      <div className="flex items-center justify-center h-full gap-2 text-slate-400">
        <Clock className="w-4 h-4 animate-pulse" />
        <span className="text-sm">Executing query...</span>
      </div>
    );
  }

  if (!result) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-sm text-slate-600">
          Execute a query to see results.
        </p>
      </div>
    );
  }

  if (result.error) {
    return (
      <div className="p-4">
        <div className="flex items-start gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
          <XCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-red-300">Query Error</p>
            <p className="text-xs font-mono text-red-400 mt-1 whitespace-pre-wrap">
              {result.error}
            </p>
          </div>
        </div>
      </div>
    );
  }

  const columns: Column[] = result.columns.map((col) => ({
    key: col,
    label: col,
    sortable: true,
  }));

  return (
    <div className="flex flex-col h-full">
      {/* Status bar */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-slate-700/50 bg-slate-800/50 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <CheckCircle className="w-3.5 h-3.5 text-green-400" />
            <span className="text-xs text-green-400 font-medium">Success</span>
          </div>
          {result.command && (
            <span className="text-xs text-slate-500">{result.command}</span>
          )}
          <span className="text-xs text-slate-500">
            {result.rowCount} rows
          </span>
          <span className="text-xs text-slate-500">{result.duration}ms</span>
        </div>

        <div className="flex items-center gap-1">
          {/* View mode toggle */}
          <div className="flex items-center bg-slate-900 rounded border border-slate-700/50 mr-1">
            <button
              onClick={() => setViewMode("table")}
              className={`flex items-center gap-1 px-2 py-0.5 text-xs rounded-l transition-colors ${
                viewMode === "table"
                  ? "bg-slate-700 text-slate-200"
                  : "text-slate-500 hover:text-slate-300"
              }`}
            >
              <Table className="w-3 h-3" />
              Table
            </button>
            <button
              onClick={() => setViewMode("raw")}
              className={`flex items-center gap-1 px-2 py-0.5 text-xs rounded-r transition-colors ${
                viewMode === "raw"
                  ? "bg-slate-700 text-slate-200"
                  : "text-slate-500 hover:text-slate-300"
              }`}
            >
              <Code className="w-3 h-3" />
              Raw
            </button>
          </div>

          <button
            onClick={handleCopyJson}
            className="flex items-center gap-1 px-2 py-0.5 text-xs text-slate-500 hover:text-slate-300 hover:bg-slate-700 rounded transition-colors"
            title="Copy as JSON"
          >
            {copied ? (
              <Check className="w-3 h-3 text-green-400" />
            ) : (
              <Copy className="w-3 h-3" />
            )}
            Copy JSON
          </button>
          <button
            onClick={handleDownloadCsv}
            className="flex items-center gap-1 px-2 py-0.5 text-xs text-slate-500 hover:text-slate-300 hover:bg-slate-700 rounded transition-colors"
            title="Download CSV"
          >
            <Download className="w-3 h-3" />
            CSV
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {viewMode === "table" ? (
          result.columns.length > 0 ? (
            <DataGrid columns={columns} rows={result.rows} />
          ) : (
            <div className="flex items-center justify-center h-full">
              <p className="text-sm text-slate-500">
                Query executed successfully — no rows returned.
              </p>
            </div>
          )
        ) : (
          <div className="h-full overflow-auto p-3">
            <pre className="text-xs font-mono text-slate-300 whitespace-pre-wrap">
              {JSON.stringify(result.rows, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}