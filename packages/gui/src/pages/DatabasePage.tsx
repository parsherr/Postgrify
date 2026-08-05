/**
 * DatabasePage — seçili DB'nin tablo listesi.
 * TanStack Table + sağda schema viewer paneli.
 */

import React from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { Table2, Plus, Trash2, ChevronRight, Database as DatabaseIcon } from "lucide-react";
import { useTables, useDropTable, useTableSchema } from "@/hooks/useTables";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import type { TableInfo } from "@/types/index";

export default function DatabasePage() {
  const { db = "" } = useParams<{ db: string }>();
  const navigate = useNavigate();
  const { data: tables, isLoading } = useTables(db);
  const { mutateAsync: dropTable, isPending: dropping } = useDropTable();

  const [selectedTable, setSelectedTable] = React.useState<string>("");
  const [deleteTarget, setDeleteTarget] = React.useState<string | null>(null);

  const { data: schema, isLoading: schemaLoading } = useTableSchema(
    db,
    selectedTable
  );

  async function handleDrop() {
    if (!deleteTarget) return;
    await dropTable({ db, table: deleteTarget });
    if (selectedTable === deleteTarget) setSelectedTable("");
    setDeleteTarget(null);
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Başlık */}
      <div className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-2.5">
        <nav className="flex items-center gap-1 text-xs text-muted-foreground">
          <Link to="/databases" className="hover:text-foreground transition-colors">
            Databases
          </Link>
          <ChevronRight className="h-3 w-3" />
          <span className="flex items-center gap-1.5 font-mono text-foreground font-medium">
            <DatabaseIcon className="h-3.5 w-3.5" />
            {db}
          </span>
        </nav>
        <div className="flex-1" />
        <Button
          size="sm"
          onClick={() => navigate(`/databases/${db}/new-table`)}
          className="gap-1.5"
        >
          <Plus className="h-3.5 w-3.5" />
          Yeni Tablo
        </Button>
      </div>

      {/* İçerik: Tablo listesi + Schema viewer */}
      <ResizablePanelGroup orientation="horizontal" className="flex-1">
        {/* Tablo listesi */}
        <ResizablePanel defaultSize={60} minSize={35}>
          <div className="h-full overflow-y-auto">
            {isLoading ? (
              <div className="space-y-1 p-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : (
              <>
                {/* Tablo başlığı */}
                <div className="grid grid-cols-[1fr_auto_auto_auto_auto] items-center gap-4 border-b border-border px-4 py-2">
                  <span className="text-2xs font-medium uppercase tracking-wider text-muted-foreground/60">
                    Tablo Adı
                  </span>
                  <span className="text-2xs font-medium uppercase tracking-wider text-muted-foreground/60 w-20 text-right">
                    Satırlar
                  </span>
                  <span className="text-2xs font-medium uppercase tracking-wider text-muted-foreground/60 w-20 text-right">
                    Boyut
                  </span>
                  <span className="w-8" />
                </div>

                {tables?.map((tbl: TableInfo) => (
                  <TableRow
                    key={tbl.name}
                    tbl={tbl}
                    db={db}
                    isSelected={selectedTable === tbl.name}
                    onSelect={() =>
                      setSelectedTable((p) => (p === tbl.name ? "" : tbl.name))
                    }
                    onDelete={() => setDeleteTarget(tbl.name)}
                  />
                ))}

                {tables?.length === 0 && (
                  <div className="flex flex-col items-center gap-3 py-16 text-center">
                    <Table2 className="h-8 w-8 text-muted-foreground/30" />
                    <p className="text-xs text-muted-foreground">Bu veritabanında tablo yok</p>
                    <Button
                      size="sm"
                      onClick={() => navigate(`/databases/${db}/new-table`)}
                      className="gap-1.5"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Tablo Oluştur
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>
        </ResizablePanel>

        <ResizableHandle />

        {/* Schema viewer */}
        <ResizablePanel defaultSize={40} minSize={25}>
          <div className="flex h-full flex-col border-l border-border">
            <div className="flex h-8 shrink-0 items-center border-b border-border px-3">
              <span className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground/60">
                Schema
              </span>
              {selectedTable && (
                <span className="ml-2 font-mono text-2xs text-muted-foreground">
                  {selectedTable}
                </span>
              )}
            </div>

            <div className="flex-1 overflow-y-auto">
              {!selectedTable ? (
                <div className="flex h-full items-center justify-center">
                  <p className="text-xs text-muted-foreground/50">
                    Tablo seçin
                  </p>
                </div>
              ) : schemaLoading ? (
                <div className="space-y-1 p-3">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Skeleton key={i} className="h-7 w-full" />
                  ))}
                </div>
              ) : (
                <div className="divide-y divide-border/40">
                  {schema?.columns.map((col) => (
                    <div
                      key={col.name}
                      className="flex items-center gap-3 px-3 py-2"
                    >
                      <span className="flex-1 truncate font-mono text-xs text-foreground/80">
                        {col.name}
                      </span>
                      <span className="font-mono text-2xs text-muted-foreground/60">
                        {col.type}
                      </span>
                      <div className="flex items-center gap-1">
                        {col.primary_key && (
                          <Badge variant="warning" className="text-2xs">PK</Badge>
                        )}
                        {col.nullable === "NO" && !col.primary_key && (
                          <Badge variant="outline" className="text-2xs">NOT NULL</Badge>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Tablo istatistikleri */}
            {selectedTable && !schemaLoading && (
              <div className="border-t border-border px-3 py-2">
                <p className="text-2xs text-muted-foreground/50">
                  {schema?.columns.length ?? 0} kolon
                </p>
              </div>
            )}
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>

      {/* Silme onayı dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Tabloyu Sil</DialogTitle>
            <DialogDescription>
              <span className="font-mono font-medium text-foreground">
                {deleteTarget}
              </span>{" "}
              tablosu ve tüm verileri kalıcı olarak silinecek. Bu işlem geri alınamaz.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteTarget(null)}>
              İptal
            </Button>
            <Button
              variant="destructive"
              onClick={handleDrop}
              disabled={dropping}
            >
              {dropping ? "Siliniyor…" : "Sil"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TableRow({
  tbl,
  db,
  isSelected,
  onSelect,
  onDelete,
}: {
  tbl: TableInfo;
  db: string;
  isSelected: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className={`group grid grid-cols-[1fr_auto_auto_auto] items-center gap-4 border-b border-border/40 px-4 py-2.5 transition-colors ${
        isSelected ? "bg-accent/20" : "hover:bg-accent/10"
      }`}
    >
      <button
        onClick={onSelect}
        className="flex items-center gap-2 text-left"
      >
        <Table2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
        <span className="font-mono text-sm text-foreground hover:underline">
          {tbl.name}
        </span>
      </button>

      <span className="w-20 text-right font-mono text-xs text-muted-foreground">
        {tbl.estimated_row_count.toLocaleString()}
      </span>
      <span className="w-20 text-right font-mono text-xs text-muted-foreground">
        {tbl.size}
      </span>

      <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        <Link
          to={`/databases/${db}/tables/${tbl.name}`}
          className="rounded px-2 py-1 text-2xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          Aç
        </Link>
        <button
          onClick={onDelete}
          className="rounded p-1 text-muted-foreground/50 transition-colors hover:bg-red-950/50 hover:text-red-400"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}