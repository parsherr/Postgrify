/**
 * DataGrid — TanStack Table + virtual scroll + inline edit + column resize.
 */

import React from "react";
import {
  useReactTable,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
  type ColumnFiltersState,
  type VisibilityState,
  type RowSelectionState,
  type Column,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  Trash2,
  Plus,
  RefreshCw,
  Download,
  Columns3,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";

export interface DataGridColumn {
  key: string;
  label: string;
  type?: string;
  primaryKey?: boolean;
  nullable?: boolean;
}

export interface DataGridProps {
  columns: DataGridColumn[];
  data: Record<string, unknown>[];
  total: number;
  page: number;
  pageSize: number;
  isLoading?: boolean;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  onRefresh?: () => void;
  onAdd?: () => void;
  onDelete?: (rows: Record<string, unknown>[]) => void;
  onCellEdit?: (row: Record<string, unknown>, col: string, value: unknown) => Promise<void>;
  /** Dışarıdan filtre chip'leri için */
  filterChips?: { label: string; onRemove: () => void }[];
}

const PAGE_SIZE_OPTIONS = [25, 50, 100];

/** Sütun başlığı — sıralama ok'larıyla */
function SortableHeader({ column, label }: { column: Column<Record<string, unknown>>; label: string }) {
  const sorted = column.getIsSorted();
  return (
    <button
      onClick={() => column.toggleSorting()}
      className="flex items-center gap-1 text-left text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
    >
      {label}
      {sorted === "asc" ? (
        <ArrowUp className="h-3 w-3" />
      ) : sorted === "desc" ? (
        <ArrowDown className="h-3 w-3" />
      ) : (
        <ArrowUpDown className="h-3 w-3 opacity-30" />
      )}
    </button>
  );
}

/** Tek hücre — inline edit destekli */
function EditableCell({
  value: initialValue,
  rowData,
  colKey,
  onEdit,
}: {
  value: unknown;
  rowData: Record<string, unknown>;
  colKey: string;
  onEdit?: (row: Record<string, unknown>, col: string, value: unknown) => Promise<void>;
}) {
  const [editing, setEditing] = React.useState(false);
  const [val, setVal] = React.useState(String(initialValue ?? ""));
  const [saving, setSaving] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (editing) inputRef.current?.select();
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
    } finally {
      setSaving(false);
      setEditing(false);
    }
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); commit(); }
          if (e.key === "Escape") { setEditing(false); setVal(String(initialValue ?? "")); }
        }}
        disabled={saving}
        className="w-full bg-zinc-800 px-1.5 py-0.5 font-mono text-xs outline-none ring-1 ring-ring rounded-sm"
      />
    );
  }

  return (
    <div
      onDoubleClick={() => onEdit && setEditing(true)}
      title={onEdit ? "Düzenlemek için çift tıklayın" : undefined}
      className={cn(
        "group truncate font-mono text-xs",
        displayValue === null ? "italic text-muted-foreground/50" : "text-foreground/90",
        onEdit && "cursor-text"
      )}
    >
      {displayValue === null ? "null" : displayValue}
    </div>
  );
}

export function DataGrid({
  columns: colDefs,
  data,
  total,
  page,
  pageSize,
  isLoading,
  onPageChange,
  onPageSizeChange,
  onRefresh,
  onAdd,
  onDelete,
  onCellEdit,
  filterChips,
}: DataGridProps) {
  const [sorting, setSorting] = React.useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([]);
  const [rowSelection, setRowSelection] = React.useState<RowSelectionState>({});
  const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>({});
  const [globalFilter, setGlobalFilter] = React.useState("");

  const tableBodyRef = React.useRef<HTMLTableSectionElement>(null);

  const columns = React.useMemo<ColumnDef<Record<string, unknown>>[]>(() => [
    // Checkbox kolonu
    {
      id: "__select",
      header: ({ table }) => (
        <input
          type="checkbox"
          checked={table.getIsAllPageRowsSelected()}
          onChange={table.getToggleAllPageRowsSelectedHandler()}
          className="rounded border-border bg-transparent"
        />
      ),
      cell: ({ row }) => (
        <input
          type="checkbox"
          checked={row.getIsSelected()}
          onChange={row.getToggleSelectedHandler()}
          onClick={(e) => e.stopPropagation()}
          className="rounded border-border bg-transparent"
        />
      ),
      size: 32,
      enableSorting: false,
    },
    // Veri kolonları
    ...colDefs.map((col): ColumnDef<Record<string, unknown>> => ({
      id: col.key,
      accessorKey: col.key,
      header: ({ column }) => <SortableHeader column={column} label={col.label} />,
      cell: ({ getValue, row }) => (
        <EditableCell
          value={getValue()}
          rowData={row.original}
          colKey={col.key}
          onEdit={onCellEdit}
        />
      ),
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
    const rows = data.map((row) =>
      headers.map((h) => {
        const v = row[h];
        const s = v === null ? "" : String(v);
        return s.includes(",") || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
      }).join(",")
    );
    const blob = new Blob([headers.join(",") + "\n" + rows.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "export.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  if (isLoading) {
    return (
      <div className="flex flex-col gap-1.5 p-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-full" />
        ))}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <Input
          placeholder="Ara…"
          value={globalFilter}
          onChange={(e) => setGlobalFilter(e.target.value)}
          className="h-7 w-40 text-xs"
        />

        <div className="flex-1" />

        {/* Filter chips */}
        {filterChips && filterChips.length > 0 && (
          <div className="flex items-center gap-1">
            {filterChips.map((chip, i) => (
              <Badge key={i} variant="outline" className="gap-1 text-2xs">
                {chip.label}
                <button onClick={chip.onRemove} className="ml-0.5 opacity-60 hover:opacity-100">×</button>
              </Badge>
            ))}
          </div>
        )}

        {selectedRows.length > 0 && onDelete && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onDelete(selectedRows)}
            className="gap-1.5 text-red-400 hover:text-red-300"
          >
            <Trash2 className="h-3.5 w-3.5" />
            {selectedRows.length} sil
          </Button>
        )}

        <Button variant="ghost" size="icon-sm" onClick={exportCsv} title="CSV indir">
          <Download className="h-3.5 w-3.5" />
        </Button>

        {onRefresh && (
          <Button variant="ghost" size="icon-sm" onClick={onRefresh} title="Yenile">
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        )}

        {/* Kolon görünürlüğü */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" title="Kolonlar">
              <Columns3 className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuLabel>Kolonlar</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {table
              .getAllColumns()
              .filter((c) => c.id !== "__select")
              .map((col) => (
                <DropdownMenuCheckboxItem
                  key={col.id}
                  checked={col.getIsVisible()}
                  onCheckedChange={(v) => col.toggleVisibility(v)}
                  className="text-xs"
                >
                  {col.id}
                </DropdownMenuCheckboxItem>
              ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {onAdd && (
          <Button size="sm" onClick={onAdd} className="gap-1.5">
            <Plus className="h-3.5 w-3.5" />
            Satır Ekle
          </Button>
        )}
      </div>

      {/* Tablo */}
      <div className="relative flex-1 overflow-auto">
        <table
          className="w-full border-collapse text-xs"
          style={{ tableLayout: "fixed", width: table.getTotalSize() }}
        >
          <thead className="sticky top-0 z-10 bg-card">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id} className="border-b border-border">
                {hg.headers.map((header) => (
                  <th
                    key={header.id}
                    style={{ width: header.getSize() }}
                    className="relative h-8 px-2 py-0 text-left align-middle"
                  >
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                    {/* Resize handle */}
                    {header.column.getCanResize() && (
                      <div
                        onMouseDown={header.getResizeHandler()}
                        onTouchStart={header.getResizeHandler()}
                        className="absolute right-0 top-0 h-full w-1 cursor-col-resize select-none bg-transparent hover:bg-zinc-600 active:bg-zinc-500"
                      />
                    )}
                  </th>
                ))}
              </tr>
            ))}
          </thead>

          <tbody
            ref={tableBodyRef}
            className="relative"
            style={{ height: totalVirtualHeight }}
          >
            {virtualItems.map((vRow) => {
              const row = rows[vRow.index];
              return (
                <tr
                  key={row.id}
                  style={{
                    position: "absolute",
                    top: vRow.start,
                    left: 0,
                    width: "100%",
                    height: vRow.size,
                  }}
                  className={cn(
                    "border-b border-border/50 transition-colors hover:bg-accent/20",
                    row.getIsSelected() && "bg-accent/30"
                  )}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td
                      key={cell.id}
                      style={{ width: cell.column.getSize() }}
                      className="h-8 overflow-hidden px-2 align-middle"
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>

        {data.length === 0 && (
          <div className="flex h-32 items-center justify-center text-xs text-muted-foreground">
            Veri yok
          </div>
        )}
      </div>

      {/* Pagination */}
      <div className="flex shrink-0 items-center justify-between border-t border-border px-3 py-2">
        <span className="text-2xs text-muted-foreground">
          {total.toLocaleString()} satır · sayfa {page + 1} / {totalPages}
          {selectedRows.length > 0 && ` · ${selectedRows.length} seçili`}
        </span>
        <div className="flex items-center gap-2">
          <select
            value={pageSize}
            onChange={(e) => onPageSizeChange(Number(e.target.value))}
            className="h-6 rounded border-border bg-transparent px-1.5 text-2xs text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          >
            {PAGE_SIZE_OPTIONS.map((s) => (
              <option key={s} value={s}>{s} satır</option>
            ))}
          </select>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={page === 0}
              onClick={() => onPageChange(0)}
              className="h-6 w-6 text-2xs"
            >
              «
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={page === 0}
              onClick={() => onPageChange(page - 1)}
              className="h-6 w-6 text-2xs"
            >
              ‹
            </Button>
            <span className="min-w-[3rem] text-center text-2xs text-muted-foreground">
              {page + 1} / {totalPages}
            </span>
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={page >= totalPages - 1}
              onClick={() => onPageChange(page + 1)}
              className="h-6 w-6 text-2xs"
            >
              ›
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={page >= totalPages - 1}
              onClick={() => onPageChange(totalPages - 1)}
              className="h-6 w-6 text-2xs"
            >
              »
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}