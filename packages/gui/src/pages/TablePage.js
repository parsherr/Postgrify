import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * TablePage — veri tablosu görünümü.
 * DataGrid bileşeni ile TanStack Table + virtual scroll + inline edit.
 */
import React from "react";
import { useParams, Link } from "react-router-dom";
import { ChevronRight, TableIcon } from "lucide-react";
import { useTableSchema } from "@/hooks/useTables";
import { useRows } from "@/hooks/useRows";
import { api } from "@/lib/api";
import { DataGrid } from "@/components/data-grid/DataGrid";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
const PAGE_SIZE_DEFAULT = 50;
export default function TablePage() {
    const { db = "", table = "" } = useParams();
    const [page, setPage] = React.useState(0);
    const [pageSize, setPageSize] = React.useState(PAGE_SIZE_DEFAULT);
    const { data: schema, isLoading: schemaLoading } = useTableSchema(db, table);
    const { data: rowsData, isLoading: rowsLoading, refetch, } = useRows(db, table, { limit: pageSize, offset: page * pageSize });
    // Sayfa değiştiğinde en üste scroll
    React.useEffect(() => {
        setPage(0);
    }, [table, db]);
    const gridColumns = React.useMemo(() => {
        if (!schema?.columns)
            return [];
        return schema.columns.map((col) => ({
            key: col.name,
            label: col.name,
            type: col.type,
            primaryKey: col.primary_key,
            nullable: col.nullable === "YES",
        }));
    }, [schema]);
    async function handleCellEdit(row, colKey, value) {
        // PK'yı bul — API'ye hangi satırı güncellediğimizi söylemek için
        const pkCol = schema?.columns.find((c) => c.primary_key);
        if (!pkCol) {
            throw new Error("Bu tablo için birincil anahtar bulunamadı");
        }
        const pkValue = row[pkCol.name];
        await api.patch(`/db/${db}/tables/${table}/rows/${pkValue}`, {
            [colKey]: value,
        });
        refetch();
    }
    async function handleDeleteRows(rows) {
        const pkCol = schema?.columns.find((c) => c.primary_key);
        if (!pkCol)
            return;
        for (const row of rows) {
            const pkValue = row[pkCol.name];
            await api.delete(`/db/${db}/tables/${table}/rows/${pkValue}`);
        }
        refetch();
    }
    const isLoading = schemaLoading || rowsLoading;
    return (_jsxs("div", { className: "flex h-full flex-col overflow-hidden", children: [_jsxs("div", { className: "flex shrink-0 items-center gap-2 border-b border-border px-4 py-2.5", children: [_jsxs("nav", { className: "flex items-center gap-1 text-xs text-muted-foreground", children: [_jsx(Link, { to: "/databases", className: "hover:text-foreground transition-colors", children: "Databases" }), _jsx(ChevronRight, { className: "h-3 w-3" }), _jsx(Link, { to: `/databases/${db}`, className: "hover:text-foreground transition-colors", children: db }), _jsx(ChevronRight, { className: "h-3 w-3" }), _jsxs("span", { className: "flex items-center gap-1.5 font-mono text-foreground font-medium", children: [_jsx(TableIcon, { className: "h-3.5 w-3.5" }), table] })] }), _jsx("div", { className: "flex-1" }), schema && !schemaLoading && (_jsxs("div", { className: "flex items-center gap-2", children: [_jsxs("span", { className: "text-2xs text-muted-foreground", children: [schema.columns.length, " kolon"] }), _jsx("div", { className: "flex items-center gap-1", children: schema.columns
                                    .filter((c) => c.primary_key)
                                    .map((c) => (_jsxs(Badge, { variant: "outline", className: "text-2xs", children: ["PK: ", c.name] }, c.name))) })] }))] }), !schemaLoading && schema && (_jsx("div", { className: "flex shrink-0 items-center gap-1.5 overflow-x-auto border-b border-border/50 bg-card/50 px-4 py-1.5", children: schema.columns.map((col) => (_jsxs("div", { className: "flex shrink-0 items-center gap-1 rounded-sm border border-border/60 bg-background px-1.5 py-0.5", children: [_jsx("span", { className: "font-mono text-2xs text-foreground/80", children: col.name }), _jsx("span", { className: "font-mono text-2xs text-muted-foreground/60", children: col.type }), col.primary_key && (_jsx("span", { className: "text-2xs text-amber-500/70", children: "PK" })), col.nullable === "NO" && !col.primary_key && (_jsx("span", { className: "text-2xs text-red-500/50", children: "!" }))] }, col.name))) })), _jsx("div", { className: "flex-1 overflow-hidden", children: isLoading ? (_jsx("div", { className: "flex flex-col gap-1.5 p-3", children: Array.from({ length: 10 }).map((_, i) => (_jsx(Skeleton, { className: "h-8 w-full" }, i))) })) : (_jsx(DataGrid, { columns: gridColumns, data: rowsData?.rows ?? [], total: rowsData?.total ?? 0, page: page, pageSize: pageSize, onPageChange: setPage, onPageSizeChange: (s) => { setPageSize(s); setPage(0); }, onRefresh: () => refetch(), onCellEdit: schema?.columns.some((c) => c.primary_key) ? handleCellEdit : undefined, onDelete: schema?.columns.some((c) => c.primary_key) ? handleDeleteRows : undefined, db: db, tableName: table })) })] }));
}
