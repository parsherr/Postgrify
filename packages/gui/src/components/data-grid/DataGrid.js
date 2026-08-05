import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * DataGrid — TanStack Table + virtual scroll + inline edit + column resize.
 */
import React from "react";
import { useReactTable, getCoreRowModel, getPaginationRowModel, getSortedRowModel, getFilteredRowModel, flexRender, } from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowUp, ArrowDown, ArrowUpDown, Trash2, Plus, RefreshCw, Download, Columns3, } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { DropdownMenu, DropdownMenuContent, DropdownMenuCheckboxItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger, } from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
const PAGE_SIZE_OPTIONS = [25, 50, 100];
/** Sütun başlığı — sıralama ok'larıyla */
function SortableHeader({ column, label }) {
    const sorted = column.getIsSorted();
    return (_jsxs("button", { onClick: () => column.toggleSorting(), className: "flex items-center gap-1 text-left text-xs font-medium text-muted-foreground transition-colors hover:text-foreground", children: [label, sorted === "asc" ? (_jsx(ArrowUp, { className: "h-3 w-3" })) : sorted === "desc" ? (_jsx(ArrowDown, { className: "h-3 w-3" })) : (_jsx(ArrowUpDown, { className: "h-3 w-3 opacity-30" }))] }));
}
/** Tek hücre — inline edit destekli */
function EditableCell({ value: initialValue, rowData, colKey, onEdit, }) {
    const [editing, setEditing] = React.useState(false);
    const [val, setVal] = React.useState(String(initialValue ?? ""));
    const [saving, setSaving] = React.useState(false);
    const inputRef = React.useRef(null);
    React.useEffect(() => {
        if (editing)
            inputRef.current?.select();
    }, [editing]);
    const displayValue = initialValue === null ? null : String(initialValue ?? "");
    async function commit() {
        if (!onEdit || val === String(initialValue ?? "")) {
            setEditing(false);
            return;
        }
        setSaving(true);
        try {
            await onEdit(rowData, colKey, val);
        }
        finally {
            setSaving(false);
            setEditing(false);
        }
    }
    if (editing) {
        return (_jsx("input", { ref: inputRef, value: val, onChange: (e) => setVal(e.target.value), onBlur: commit, onKeyDown: (e) => {
                if (e.key === "Enter") {
                    e.preventDefault();
                    commit();
                }
                if (e.key === "Escape") {
                    setEditing(false);
                    setVal(String(initialValue ?? ""));
                }
            }, disabled: saving, className: "w-full bg-zinc-800 px-1.5 py-0.5 font-mono text-xs outline-none ring-1 ring-ring rounded-sm" }));
    }
    return (_jsx("div", { onDoubleClick: () => onEdit && setEditing(true), title: onEdit ? "Düzenlemek için çift tıklayın" : undefined, className: cn("group truncate font-mono text-xs", displayValue === null ? "italic text-muted-foreground/50" : "text-foreground/90", onEdit && "cursor-text"), children: displayValue === null ? "null" : displayValue }));
}
export function DataGrid({ columns: colDefs, data, total, page, pageSize, isLoading, onPageChange, onPageSizeChange, onRefresh, onAdd, onDelete, onCellEdit, filterChips, }) {
    const [sorting, setSorting] = React.useState([]);
    const [columnFilters, setColumnFilters] = React.useState([]);
    const [rowSelection, setRowSelection] = React.useState({});
    const [columnVisibility, setColumnVisibility] = React.useState({});
    const [globalFilter, setGlobalFilter] = React.useState("");
    const tableBodyRef = React.useRef(null);
    const columns = React.useMemo(() => [
        // Checkbox kolonu
        {
            id: "__select",
            header: ({ table }) => (_jsx("input", { type: "checkbox", checked: table.getIsAllPageRowsSelected(), onChange: table.getToggleAllPageRowsSelectedHandler(), className: "rounded border-border bg-transparent" })),
            cell: ({ row }) => (_jsx("input", { type: "checkbox", checked: row.getIsSelected(), onChange: row.getToggleSelectedHandler(), onClick: (e) => e.stopPropagation(), className: "rounded border-border bg-transparent" })),
            size: 32,
            enableSorting: false,
        },
        // Veri kolonları
        ...colDefs.map((col) => ({
            id: col.key,
            accessorKey: col.key,
            header: ({ column }) => _jsx(SortableHeader, { column: column, label: col.label }),
            cell: ({ getValue, row }) => (_jsx(EditableCell, { value: getValue(), rowData: row.original, colKey: col.key, onEdit: onCellEdit })),
            size: 150,
        })),
    ], [colDefs, onCellEdit]);
    const table = useReactTable({
        data,
        columns,
        manualPagination: true,
        pageCount: Math.ceil(total / pageSize),
        state: {
            sorting,
            columnFilters,
            rowSelection,
            columnVisibility,
            globalFilter,
            pagination: { pageIndex: page, pageSize },
        },
        onSortingChange: setSorting,
        onColumnFiltersChange: setColumnFilters,
        onRowSelectionChange: setRowSelection,
        onColumnVisibilityChange: setColumnVisibility,
        onGlobalFilterChange: setGlobalFilter,
        getCoreRowModel: getCoreRowModel(),
        getPaginationRowModel: getPaginationRowModel(),
        getSortedRowModel: getSortedRowModel(),
        getFilteredRowModel: getFilteredRowModel(),
        enableRowSelection: true,
        columnResizeMode: "onChange",
    });
    // Virtual scroll — tablo büyük veri için
    const rows = table.getRowModel().rows;
    const virtualizer = useVirtualizer({
        count: rows.length,
        getScrollElement: () => tableBodyRef.current,
        estimateSize: () => 32,
        overscan: 10,
    });
    const virtualItems = virtualizer.getVirtualItems();
    const totalVirtualHeight = virtualizer.getTotalSize();
    const selectedRows = table.getSelectedRowModel().rows.map((r) => r.original);
    const totalPages = Math.ceil(total / pageSize);
    function exportCsv() {
        const headers = colDefs.map((c) => c.key);
        const rows = data.map((row) => headers.map((h) => {
            const v = row[h];
            const s = v === null ? "" : String(v);
            return s.includes(",") || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
        }).join(","));
        const blob = new Blob([headers.join(",") + "\n" + rows.join("\n")], { type: "text/csv" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "export.csv";
        a.click();
        URL.revokeObjectURL(url);
    }
    if (isLoading) {
        return (_jsx("div", { className: "flex flex-col gap-1.5 p-3", children: Array.from({ length: 8 }).map((_, i) => (_jsx(Skeleton, { className: "h-8 w-full" }, i))) }));
    }
    return (_jsxs("div", { className: "flex h-full flex-col overflow-hidden", children: [_jsxs("div", { className: "flex shrink-0 items-center gap-2 border-b border-border px-3 py-2", children: [_jsx(Input, { placeholder: "Ara\u2026", value: globalFilter, onChange: (e) => setGlobalFilter(e.target.value), className: "h-7 w-40 text-xs" }), _jsx("div", { className: "flex-1" }), filterChips && filterChips.length > 0 && (_jsx("div", { className: "flex items-center gap-1", children: filterChips.map((chip, i) => (_jsxs(Badge, { variant: "outline", className: "gap-1 text-2xs", children: [chip.label, _jsx("button", { onClick: chip.onRemove, className: "ml-0.5 opacity-60 hover:opacity-100", children: "\u00D7" })] }, i))) })), selectedRows.length > 0 && onDelete && (_jsxs(Button, { variant: "ghost", size: "sm", onClick: () => onDelete(selectedRows), className: "gap-1.5 text-red-400 hover:text-red-300", children: [_jsx(Trash2, { className: "h-3.5 w-3.5" }), selectedRows.length, " sil"] })), _jsx(Button, { variant: "ghost", size: "icon-sm", onClick: exportCsv, title: "CSV indir", children: _jsx(Download, { className: "h-3.5 w-3.5" }) }), onRefresh && (_jsx(Button, { variant: "ghost", size: "icon-sm", onClick: onRefresh, title: "Yenile", children: _jsx(RefreshCw, { className: "h-3.5 w-3.5" }) })), _jsxs(DropdownMenu, { children: [_jsx(DropdownMenuTrigger, { asChild: true, children: _jsx(Button, { variant: "ghost", size: "icon-sm", title: "Kolonlar", children: _jsx(Columns3, { className: "h-3.5 w-3.5" }) }) }), _jsxs(DropdownMenuContent, { align: "end", className: "w-44", children: [_jsx(DropdownMenuLabel, { children: "Kolonlar" }), _jsx(DropdownMenuSeparator, {}), table
                                        .getAllColumns()
                                        .filter((c) => c.id !== "__select")
                                        .map((col) => (_jsx(DropdownMenuCheckboxItem, { checked: col.getIsVisible(), onCheckedChange: (v) => col.toggleVisibility(v), className: "text-xs", children: col.id }, col.id)))] })] }), onAdd && (_jsxs(Button, { size: "sm", onClick: onAdd, className: "gap-1.5", children: [_jsx(Plus, { className: "h-3.5 w-3.5" }), "Sat\u0131r Ekle"] }))] }), _jsxs("div", { className: "relative flex-1 overflow-auto", children: [_jsxs("table", { className: "w-full border-collapse text-xs", style: { tableLayout: "fixed", width: table.getTotalSize() }, children: [_jsx("thead", { className: "sticky top-0 z-10 bg-card", children: table.getHeaderGroups().map((hg) => (_jsx("tr", { className: "border-b border-border", children: hg.headers.map((header) => (_jsxs("th", { style: { width: header.getSize() }, className: "relative h-8 px-2 py-0 text-left align-middle", children: [header.isPlaceholder
                                                ? null
                                                : flexRender(header.column.columnDef.header, header.getContext()), header.column.getCanResize() && (_jsx("div", { onMouseDown: header.getResizeHandler(), onTouchStart: header.getResizeHandler(), className: "absolute right-0 top-0 h-full w-1 cursor-col-resize select-none bg-transparent hover:bg-zinc-600 active:bg-zinc-500" }))] }, header.id))) }, hg.id))) }), _jsx("tbody", { ref: tableBodyRef, className: "relative", style: { height: totalVirtualHeight }, children: virtualItems.map((vRow) => {
                                    const row = rows[vRow.index];
                                    return (_jsx("tr", { style: {
                                            position: "absolute",
                                            top: vRow.start,
                                            left: 0,
                                            width: "100%",
                                            height: vRow.size,
                                        }, className: cn("border-b border-border/50 transition-colors hover:bg-accent/20", row.getIsSelected() && "bg-accent/30"), children: row.getVisibleCells().map((cell) => (_jsx("td", { style: { width: cell.column.getSize() }, className: "h-8 overflow-hidden px-2 align-middle", children: flexRender(cell.column.columnDef.cell, cell.getContext()) }, cell.id))) }, row.id));
                                }) })] }), data.length === 0 && (_jsx("div", { className: "flex h-32 items-center justify-center text-xs text-muted-foreground", children: "Veri yok" }))] }), _jsxs("div", { className: "flex shrink-0 items-center justify-between border-t border-border px-3 py-2", children: [_jsxs("span", { className: "text-2xs text-muted-foreground", children: [total.toLocaleString(), " sat\u0131r \u00B7 sayfa ", page + 1, " / ", totalPages, selectedRows.length > 0 && ` · ${selectedRows.length} seçili`] }), _jsxs("div", { className: "flex items-center gap-2", children: [_jsx("select", { value: pageSize, onChange: (e) => onPageSizeChange(Number(e.target.value)), className: "h-6 rounded border-border bg-transparent px-1.5 text-2xs text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring", children: PAGE_SIZE_OPTIONS.map((s) => (_jsxs("option", { value: s, children: [s, " sat\u0131r"] }, s))) }), _jsxs("div", { className: "flex items-center gap-1", children: [_jsx(Button, { variant: "ghost", size: "icon-sm", disabled: page === 0, onClick: () => onPageChange(0), className: "h-6 w-6 text-2xs", children: "\u00AB" }), _jsx(Button, { variant: "ghost", size: "icon-sm", disabled: page === 0, onClick: () => onPageChange(page - 1), className: "h-6 w-6 text-2xs", children: "\u2039" }), _jsxs("span", { className: "min-w-[3rem] text-center text-2xs text-muted-foreground", children: [page + 1, " / ", totalPages] }), _jsx(Button, { variant: "ghost", size: "icon-sm", disabled: page >= totalPages - 1, onClick: () => onPageChange(page + 1), className: "h-6 w-6 text-2xs", children: "\u203A" }), _jsx(Button, { variant: "ghost", size: "icon-sm", disabled: page >= totalPages - 1, onClick: () => onPageChange(totalPages - 1), className: "h-6 w-6 text-2xs", children: "\u00BB" })] })] })] })] }));
}
