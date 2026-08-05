/**
 * ResultsPanel — sorgu sonuçları (tablo) ve hata görünümü.
 */

import React from "react";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  type ColumnDef,
} from "@tanstack/react-table";
interface ResultsPanelProps {
  rows: Record<string, unknown>[] | null;
  error: string | null;
  rowCount?: number;
  duration?: number;
  isRunning?: boolean;
}

function ResultsTable({ rows }: { rows: Record<string, unknown>[] }) {
  const columns = React.useMemo<ColumnDef<Record<string, unknown>>[]>(() => {
    if (rows.length === 0) return [];
    return Object.keys(rows[0]).map((key) => ({
      id: key,
      accessorKey: key,
      header: key,
      cell: ({ getValue }) => {
        const v = getValue();
        if (v === null) {
          return <span className="italic text-muted-foreground/50">null</span>;
        }
        return <span className="font-mono text-xs text-foreground/90">{String(v)}</span>;
      },
    }));
  }, [rows]);

  const table = useReactTable({
    data: rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  return (
    <div className="h-full overflow-auto">
      <table className="w-full border-collapse text-xs">
        <thead className="sticky top-0 z-10 bg-card">
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id} className="border-b border-border">
              {hg.headers.map((header) => (
                <th
                  key={header.id}
                  className="h-7 px-3 py-0 text-left align-middle text-xs font-medium text-muted-foreground"
                >
                  {header.isPlaceholder
                    ? null
                    : flexRender(header.column.columnDef.header, header.getContext())}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr
              key={row.id}
              className="border-b border-border/40 transition-colors hover:bg-accent/20"
            >
              {row.getVisibleCells().map((cell) => (
                <td key={cell.id} className="h-8 max-w-xs truncate px-3 align-middle">
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      {rows.length === 0 && (
        <div className="flex h-16 items-center justify-center text-xs text-muted-foreground">
          0 satır döndü
        </div>
      )}
    </div>
  );
}

export function ResultsPanel({
  rows,
  error,
  rowCount,
  duration,
  isRunning,
}: ResultsPanelProps) {
  if (isRunning) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-xs text-muted-foreground">
        <span className="animate-spin">⏳</span>
        Sorgu çalışıyor…
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full flex-col gap-2 p-4">
        <div className="flex items-center gap-2 text-red-400">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span className="text-xs font-medium">Sorgu Hatası</span>
        </div>
        <pre className="flex-1 overflow-auto rounded border border-red-900/50 bg-red-950/30 p-3 font-mono text-xs text-red-400 whitespace-pre-wrap">
          {error}
        </pre>
      </div>
    );
  }

  if (rows === null) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground/50">
        Sorguyu çalıştırmak için ⌘↵ veya Run butonunu kullanın
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Durum çubuğu */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-1.5">
        <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
        <span className="text-2xs text-muted-foreground">
          {rowCount ?? rows.length} satır
          {duration !== undefined && ` · ${duration}ms`}
        </span>
      </div>

      <div className="flex-1 overflow-hidden">
        <ResultsTable rows={rows} />
      </div>
    </div>
  );
}