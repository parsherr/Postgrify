import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * ResultsPanel — sorgu sonuçları (tablo) ve hata görünümü.
 */
import React from "react";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { useReactTable, getCoreRowModel, flexRender, } from "@tanstack/react-table";
function ResultsTable({ rows }) {
    const columns = React.useMemo(() => {
        if (rows.length === 0)
            return [];
        return Object.keys(rows[0]).map((key) => ({
            id: key,
            accessorKey: key,
            header: key,
            cell: ({ getValue }) => {
                const v = getValue();
                if (v === null) {
                    return _jsx("span", { className: "italic text-muted-foreground/50", children: "null" });
                }
                return _jsx("span", { className: "font-mono text-xs text-foreground/90", children: String(v) });
            },
        }));
    }, [rows]);
    const table = useReactTable({
        data: rows,
        columns,
        getCoreRowModel: getCoreRowModel(),
    });
    return (_jsxs("div", { className: "h-full overflow-auto", children: [_jsxs("table", { className: "w-full border-collapse text-xs", children: [_jsx("thead", { className: "sticky top-0 z-10 bg-card", children: table.getHeaderGroups().map((hg) => (_jsx("tr", { className: "border-b border-border", children: hg.headers.map((header) => (_jsx("th", { className: "h-7 px-3 py-0 text-left align-middle text-xs font-medium text-muted-foreground", children: header.isPlaceholder
                                    ? null
                                    : flexRender(header.column.columnDef.header, header.getContext()) }, header.id))) }, hg.id))) }), _jsx("tbody", { children: table.getRowModel().rows.map((row) => (_jsx("tr", { className: "border-b border-border/40 transition-colors hover:bg-accent/20", children: row.getVisibleCells().map((cell) => (_jsx("td", { className: "h-8 max-w-xs truncate px-3 align-middle", children: flexRender(cell.column.columnDef.cell, cell.getContext()) }, cell.id))) }, row.id))) })] }), rows.length === 0 && (_jsx("div", { className: "flex h-16 items-center justify-center text-xs text-muted-foreground", children: "0 sat\u0131r d\u00F6nd\u00FC" }))] }));
}
export function ResultsPanel({ rows, error, rowCount, duration, isRunning, }) {
    if (isRunning) {
        return (_jsxs("div", { className: "flex h-full items-center justify-center gap-2 text-xs text-muted-foreground", children: [_jsx("span", { className: "animate-spin", children: "\u23F3" }), "Sorgu \u00E7al\u0131\u015F\u0131yor\u2026"] }));
    }
    if (error) {
        return (_jsxs("div", { className: "flex h-full flex-col gap-2 p-4", children: [_jsxs("div", { className: "flex items-center gap-2 text-red-400", children: [_jsx(AlertCircle, { className: "h-4 w-4 shrink-0" }), _jsx("span", { className: "text-xs font-medium", children: "Sorgu Hatas\u0131" })] }), _jsx("pre", { className: "flex-1 overflow-auto rounded border border-red-900/50 bg-red-950/30 p-3 font-mono text-xs text-red-400 whitespace-pre-wrap", children: error })] }));
    }
    if (rows === null) {
        return (_jsx("div", { className: "flex h-full items-center justify-center text-xs text-muted-foreground/50", children: "Sorguyu \u00E7al\u0131\u015Ft\u0131rmak i\u00E7in \u2318\u21B5 veya Run butonunu kullan\u0131n" }));
    }
    return (_jsxs("div", { className: "flex h-full flex-col", children: [_jsxs("div", { className: "flex shrink-0 items-center gap-2 border-b border-border px-3 py-1.5", children: [_jsx(CheckCircle2, { className: "h-3.5 w-3.5 text-green-500" }), _jsxs("span", { className: "text-2xs text-muted-foreground", children: [rowCount ?? rows.length, " sat\u0131r", duration !== undefined && ` · ${duration}ms`] })] }), _jsx("div", { className: "flex-1 overflow-hidden", children: _jsx(ResultsTable, { rows: rows }) })] }));
}
