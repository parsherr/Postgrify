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
import { DataGrid, type DataGridColumn } from "@/components/data-grid/DataGrid";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import type { Column } from "@/types/index";

const PAGE_SIZE_DEFAULT = 50;

export default function TablePage() {
  const { db = "", table = "" } = useParams<{ db: string; table: string }>();
  const [page, setPage] = React.useState(0);
  const [pageSize, setPageSize] = React.useState(PAGE_SIZE_DEFAULT);

  const { data: schema, isLoading: schemaLoading } = useTableSchema(db, table);
  const {
    data: rowsData,
    isLoading: rowsLoading,
    refetch,
  } = useRows(db, table, { limit: pageSize, offset: page * pageSize });

  // Sayfa değiştiğinde en üste scroll
  React.useEffect(() => {
    setPage(0);
  }, [table, db]);

  const gridColumns: DataGridColumn[] = React.useMemo(() => {
    if (!schema?.columns) return [];
    return schema.columns.map((col: Column) => ({
      key: col.name,
      label: col.name,
      type: col.type,
      primaryKey: col.primary_key,
      nullable: col.nullable === "YES",
    }));
  }, [schema]);

  async function handleCellEdit(
    row: Record<string, unknown>,
    colKey: string,
    value: unknown
  ) {
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

  async function handleDeleteRows(rows: Record<string, unknown>[]) {
    const pkCol = schema?.columns.find((c) => c.primary_key);
    if (!pkCol) return;
    for (const row of rows) {
      const pkValue = row[pkCol.name];
      await api.delete(`/db/${db}/tables/${table}/rows/${pkValue}`);
    }
    refetch();
  }

  const isLoading = schemaLoading || rowsLoading;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Başlık */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2.5">
        <nav className="flex items-center gap-1 text-xs text-muted-foreground">
          <Link to="/databases" className="hover:text-foreground transition-colors">
            Databases
          </Link>
          <ChevronRight className="h-3 w-3" />
          <Link to={`/databases/${db}`} className="hover:text-foreground transition-colors">
            {db}
          </Link>
          <ChevronRight className="h-3 w-3" />
          <span className="flex items-center gap-1.5 font-mono text-foreground font-medium">
            <TableIcon className="h-3.5 w-3.5" />
            {table}
          </span>
        </nav>

        <div className="flex-1" />

        {/* Kolon meta bilgileri */}
        {schema && !schemaLoading && (
          <div className="flex items-center gap-2">
            <span className="text-2xs text-muted-foreground">
              {schema.columns.length} kolon
            </span>
            <div className="flex items-center gap-1">
              {schema.columns
                .filter((c: Column) => c.primary_key)
                .map((c: Column) => (
                  <Badge key={c.name} variant="outline" className="text-2xs">
                    PK: {c.name}
                  </Badge>
                ))}
            </div>
          </div>
        )}
      </div>

      {/* Kolon şeması — ince bilgi çubuğu */}
      {!schemaLoading && schema && (
        <div className="flex shrink-0 items-center gap-1.5 overflow-x-auto border-b border-border/50 bg-card/50 px-4 py-1.5">
          {schema.columns.map((col: Column) => (
            <div
              key={col.name}
              className="flex shrink-0 items-center gap-1 rounded-sm border border-border/60 bg-background px-1.5 py-0.5"
            >
              <span className="font-mono text-2xs text-foreground/80">{col.name}</span>
              <span className="font-mono text-2xs text-muted-foreground/60">{col.type}</span>
              {col.primary_key && (
                <span className="text-2xs text-amber-500/70">PK</span>
              )}
              {col.nullable === "NO" && !col.primary_key && (
                <span className="text-2xs text-red-500/50">!</span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Ana grid */}
      <div className="flex-1 overflow-hidden">
        {isLoading ? (
          <div className="flex flex-col gap-1.5 p-3">
            {Array.from({ length: 10 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        ) : (
          <DataGrid
            columns={gridColumns}
            data={rowsData?.rows ?? []}
            total={rowsData?.total ?? 0}
            page={page}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={(s) => { setPageSize(s); setPage(0); }}
            onRefresh={() => refetch()}
            onCellEdit={schema?.columns.some((c: Column) => c.primary_key) ? handleCellEdit : undefined}
            onDelete={schema?.columns.some((c: Column) => c.primary_key) ? handleDeleteRows : undefined}
          />
        )}
      </div>
    </div>
  );
}