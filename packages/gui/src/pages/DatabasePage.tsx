/**
 * DatabasePage — Proxmox tarzı DB detay sayfası.
 *
 * Sol: dikey sekme nav (Summary, Tables & Schema, Data, SQL Editor, Options)
 * Sag: secilen sekmenin icerigi
 *
 * URL: /databases/:db   ?tab=summary|tables|data|query|options
 */

import React from "react";
import { useParams, useSearchParams, Link } from "react-router-dom";
import {
  LayoutDashboard,
  Table2,
  Rows3,
  Terminal,
  Settings2,
  Play,
  PowerOff,
  Loader2,
  Database,
  HardDrive,
  Clock,
  Hash,
  ChevronRight,
  Copy,
  Check,
  Archive,
  KeyRound,
  Square,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn, formatBytes } from "@/lib/utils";
import { useDatabases, useStopPool, useStartPool } from "@/hooks/useDatabases";
import { useTables, useTableSchema, useDropTable } from "@/hooks/useTables";
import { useRows, useDeleteRow, useUpdateRow } from "@/hooks/useRows";
import type { Database as DbType } from "@/types";
import { DataGrid } from "@/components/data-grid/DataGrid";
import type { DataGridColumn } from "@/components/data-grid/DataGrid";
import { QueryEditor } from "@/components/query-editor/QueryEditor";
import { ResultsPanel } from "@/components/query-editor/ResultsPanel";
import { saveToHistory } from "@/components/query-editor/QueryHistory";
import { api } from "@/lib/api";

// ── Sekme tanimlari ──────────────────────────────────────────────────────────

const TABS = [
  { id: "summary", label: "Summary",          icon: LayoutDashboard },
  { id: "tables",  label: "Tables & Schema",  icon: Table2 },
  { id: "data",    label: "Data",             icon: Rows3 },
  { id: "query",   label: "SQL Editor",       icon: Terminal },
  { id: "backup",  label: "Backup",           icon: Archive },
  { id: "auths",   label: "Auths",            icon: KeyRound },
  { id: "options", label: "Database Options", icon: Settings2 },
] as const;

type TabId = (typeof TABS)[number]["id"];

// ── Uptime sayaci ────────────────────────────────────────────────────────────

function useUptime(startedAt: number | null) {
  const [now, setNow] = React.useState(Date.now());
  React.useEffect(() => {
    if (!startedAt) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [startedAt]);

  if (!startedAt) return null;
  const sec = Math.floor((now - startedAt) / 1000);
  const h = Math.floor(sec / 3600).toString().padStart(2, "0");
  const m = Math.floor((sec % 3600) / 60).toString().padStart(2, "0");
  const s = (sec % 60).toString().padStart(2, "0");
  return `${h}:${m}:${s}`;
}

// ── Ana bilesen ───────────────────────────────────────────────────────────────

export default function DatabasePage() {
  const { db } = useParams<{ db: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = (searchParams.get("tab") as TabId) ?? "summary";

  const { data: databases, isLoading: dbLoading } = useDatabases();
  const dbInfo: DbType | undefined = databases?.find((d) => d.name === db);

  const { mutateAsync: stopPool, isPending: stopping } = useStopPool();
  const { mutateAsync: startPool, isPending: starting } = useStartPool();
  const [poolActionLoading, setPoolActionLoading] = React.useState(false);

  const uptime = useUptime(dbInfo?.pool_started_at ?? null);

  if (!db) return null;

  function setTab(id: TabId) {
    setSearchParams({ tab: id });
  }

  async function handlePoolToggle() {
    if (!dbInfo) return;
    setPoolActionLoading(true);
    try {
      if (dbInfo.pool_active) {
        await stopPool(db!);
      } else {
        await startPool(db!);
      }
    } finally {
      setPoolActionLoading(false);
    }
  }

  const isActionLoading = poolActionLoading || stopping || starting;

  return (
    <div className="flex h-full overflow-hidden">

      {/* Sol sekme nav */}
      <div className="flex w-52 shrink-0 flex-col border-r border-border bg-card">
        {/* DB baslik */}
        <div className="flex h-10 items-center gap-2 border-b border-border px-3">
          <div className="relative shrink-0">
            <Database className="h-4 w-4 text-muted-foreground" />
            <span
              className={cn(
                "absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full border border-card",
                dbInfo?.pool_active ? "bg-green-500" : "bg-red-500"
              )}
            />
          </div>
          <span className="truncate font-mono text-sm font-semibold">{db}</span>
        </div>

        {/* Sekmeler */}
        <nav className="flex-1 py-2">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={cn(
                "flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs transition-colors",
                activeTab === id
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:bg-accent/40 hover:text-foreground"
              )}
            >
              <Icon className="h-3.5 w-3.5 shrink-0" />
              {label}
            </button>
          ))}
        </nav>

        {/* Alt: geri linki */}
        <div className="border-t border-border p-2">
          <Link
            to="/databases"
            className="flex items-center gap-1.5 rounded px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent/30 hover:text-foreground"
          >
            <ChevronRight className="h-3 w-3 rotate-180" />
            Veritabanlari
          </Link>
        </div>
      </div>

      {/* Sag icerik */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Baslik bari */}
        <div className="flex h-10 shrink-0 items-center justify-between border-b border-border px-4">
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm font-semibold">{db}</span>
            {dbInfo?.pool_active && uptime && (
              <span className="text-xs text-muted-foreground">(Uptime: {uptime})</span>
            )}
            <Badge
              variant="outline"
              className={cn(
                "h-4 px-1.5 text-2xs",
                dbInfo?.pool_active
                  ? "border-green-500/30 text-green-400"
                  : "border-red-500/30 text-red-400"
              )}
            >
              {dbInfo?.pool_active ? "running" : "stopped"}
            </Badge>
          </div>

          <div className="flex items-center gap-2">
            {dbInfo?.pool_active ? (
              <Button
                size="sm"
                variant="outline"
                onClick={handlePoolToggle}
                disabled={isActionLoading}
                className="h-7 gap-1.5 border-red-500/30 text-red-400 hover:border-red-500/60 hover:bg-red-950/30 hover:text-red-300"
              >
                {isActionLoading ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <PowerOff className="h-3 w-3" />
                )}
                Durdur
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={handlePoolToggle}
                disabled={isActionLoading}
                className="h-7 gap-1.5"
              >
                {isActionLoading ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Play className="h-3 w-3" />
                )}
                Baslat
              </Button>
            )}
          </div>
        </div>

        {/* Sekme icerigi */}
        <div className="min-h-0 flex-1 overflow-hidden">
          {dbLoading ? (
            <div className="space-y-3 p-6">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-8 w-full" />
              ))}
            </div>
          ) : activeTab === "summary" ? (
            <SummaryTab db={db} dbInfo={dbInfo} uptime={uptime} />
          ) : activeTab === "tables" ? (
            <TablesTab db={db} />
          ) : activeTab === "data" ? (
            <DataTab db={db} />
          ) : activeTab === "query" ? (
            <SqlEditorTab db={db} />
          ) : activeTab === "backup" ? (
            <PlaceholderTab label="Backup" description="Veritabani yedekleme ve geri yukleme ozellikleri yakininda eklenecek." />
          ) : activeTab === "auths" ? (
            <PlaceholderTab label="Auths" description="Veritabani erisim yetkilendirme yonetimi yakininda eklenecek." />
          ) : (
            <OptionsTab db={db} dbInfo={dbInfo} />
          )}
        </div>
      </div>
    </div>
  );
}

// ── Summary Tab ──────────────────────────────────────────────────────────────

function SummaryTab({
  db,
  dbInfo,
  uptime,
}: {
  db: string;
  dbInfo: DbType | undefined;
  uptime: string | null;
}) {
  const stats = [
    {
      label: "Status",
      value: dbInfo?.pool_active ? "running" : "stopped",
      icon: Database,
      accent: dbInfo?.pool_active ? "text-green-400" : "text-red-400",
    },
    {
      label: "Disk boyutu",
      value: formatBytes(dbInfo?.size_bytes ?? 0),
      icon: HardDrive,
      accent: "text-foreground",
    },
    {
      label: "Tablo sayisi",
      value: String(dbInfo?.table_count ?? 0),
      icon: Hash,
      accent: "text-foreground",
    },
    {
      label: "Uptime",
      value: uptime ?? "—",
      icon: Clock,
      accent: "text-foreground",
    },
  ];

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mx-auto max-w-2xl space-y-6">
        <div className="overflow-hidden rounded border border-border bg-card">
          {stats.map((stat, i) => {
            const Icon = stat.icon;
            return (
              <div
                key={stat.label}
                className={cn(
                  "flex items-center justify-between px-4 py-3",
                  i !== stats.length - 1 && "border-b border-border/50"
                )}
              >
                <div className="flex items-center gap-2.5 text-sm text-muted-foreground">
                  <Icon className="h-3.5 w-3.5 shrink-0" />
                  {stat.label}
                </div>
                <span className={cn("font-mono text-sm font-medium", stat.accent)}>
                  {stat.value}
                </span>
              </div>
            );
          })}
        </div>

        <div className="rounded border border-border bg-card p-4">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground/60">
            Baglanti
          </h3>
          <div className="font-mono text-xs text-muted-foreground">
            <span className="text-foreground/60">postgresql://.../{db}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Tables & Schema Tab ───────────────────────────────────────────────────────

function TablesTab({ db }: { db: string }) {
  const { data: tables, isLoading } = useTables(db);
  const [selectedTable, setSelectedTable] = React.useState<string | null>(null);
  const { data: schema, isLoading: schemaLoading } = useTableSchema(
    db,
    selectedTable ?? ""
  );
  const { mutateAsync: dropTable, isPending: dropping } = useDropTable();
  const [copied, setCopied] = React.useState(false);

  const ddl = React.useMemo(() => {
    if (!schema) return "";
    const cols = schema.columns
      .map((c) => {
        let def = `  "${c.name}" ${c.type}`;
        if (c.primary_key) def += " PRIMARY KEY";
        if (c.nullable === "NO" && !c.primary_key) def += " NOT NULL";
        if (c.default) def += ` DEFAULT ${c.default}`;
        return def;
      })
      .join(",\n");
    return `CREATE TABLE "${schema.table}" (\n${cols}\n);`;
  }, [schema]);

  function copyDdl() {
    navigator.clipboard.writeText(ddl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* Sol: tablo listesi */}
      <div className="w-56 shrink-0 overflow-y-auto border-r border-border bg-card/50">
        <div className="flex h-7 items-center border-b border-border px-3">
          <span className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground/50">
            Tablolar
          </span>
          {tables && (
            <span className="ml-auto font-mono text-2xs text-muted-foreground/40">
              {tables.length}
            </span>
          )}
        </div>
        <div className="py-1">
          {isLoading
            ? Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="mx-2 my-1 h-6" />
              ))
            : tables?.map((tbl) => (
                <button
                  key={tbl.name}
                  onClick={() => setSelectedTable(tbl.name)}
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors",
                    selectedTable === tbl.name
                      ? "bg-accent text-foreground"
                      : "text-muted-foreground hover:bg-accent/30 hover:text-foreground"
                  )}
                >
                  <Table2 className="h-3 w-3 shrink-0 text-muted-foreground/50" />
                  <span className="flex-1 truncate font-mono">{tbl.name}</span>
                </button>
              ))}
        </div>
      </div>

      {/* Sag: schema detayi */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {!selectedTable ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Bir tablo secin
          </div>
        ) : schemaLoading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        ) : schema ? (
          <div className="overflow-y-auto p-4">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-mono text-sm font-semibold">{schema.table}</h2>
              <button
                onClick={() => {
                  if (
                    window.confirm(
                      `"${selectedTable}" tablosunu silmek istiyor musun?`
                    )
                  ) {
                    dropTable({ db, table: selectedTable }).then(() =>
                      setSelectedTable(null)
                    );
                  }
                }}
                disabled={dropping}
                className="text-2xs text-red-400/60 transition-colors hover:text-red-400"
              >
                {dropping ? "Siliniyor..." : "Tabloyu sil"}
              </button>
            </div>

            {/* Kolon tablosu */}
            <div className="mb-4 overflow-hidden rounded border border-border">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border bg-card">
                    {["Kolon", "Tip", "Nullable", "Default", ""].map((h) => (
                      <th
                        key={h}
                        className="px-3 py-2 text-left font-medium text-muted-foreground/60"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {schema.columns.map((col) => (
                    <tr
                      key={col.name}
                      className="border-b border-border/40 last:border-0 hover:bg-accent/10"
                    >
                      <td className="px-3 py-2 font-mono">{col.name}</td>
                      <td className="px-3 py-2 font-mono text-muted-foreground">
                        {col.type}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground/60">
                        {col.nullable}
                      </td>
                      <td className="px-3 py-2 font-mono text-muted-foreground/60">
                        {col.default ?? "—"}
                      </td>
                      <td className="px-3 py-2">
                        {col.primary_key && (
                          <Badge
                            variant="outline"
                            className="h-4 border-amber-500/30 px-1 text-2xs text-amber-400"
                          >
                            PK
                          </Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* DDL */}
            <div className="rounded border border-border bg-zinc-950">
              <div className="flex items-center justify-between border-b border-border/50 px-3 py-1.5">
                <span className="text-2xs font-medium text-muted-foreground/60">
                  CREATE TABLE
                </span>
                <button
                  onClick={copyDdl}
                  className="flex items-center gap-1 text-2xs text-muted-foreground/50 transition-colors hover:text-foreground"
                >
                  {copied ? (
                    <Check className="h-3 w-3 text-green-400" />
                  ) : (
                    <Copy className="h-3 w-3" />
                  )}
                  {copied ? "Kopyalandi" : "Kopyala"}
                </button>
              </div>
              <pre className="overflow-x-auto p-3 font-mono text-xs text-foreground/80">
                {ddl}
              </pre>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ── Data Tab ──────────────────────────────────────────────────────────────────

function DataTab({ db }: { db: string }) {
  const { data: tables, isLoading: tablesLoading } = useTables(db);
  const [selectedTable, setSelectedTable] = React.useState<string>("");
  const [page, setPage] = React.useState(0);
  const [pageSize, setPageSize] = React.useState(25);

  React.useEffect(() => {
    if (tables && tables.length > 0 && !selectedTable) {
      setSelectedTable(tables[0].name);
    }
  }, [tables, selectedTable]);

  React.useEffect(() => {
    setPage(0);
  }, [selectedTable]);

  const { data: rowsResult, isLoading: rowsLoading, refetch } = useRows(
    db,
    selectedTable,
    { limit: pageSize, offset: page * pageSize }
  );

  const columns: DataGridColumn[] = React.useMemo(() => {
    if (!rowsResult?.rows?.length) return [];
    return Object.keys(rowsResult.rows[0]).map((key) => ({
      key,
      label: key,
      type: "text" as const,
    }));
  }, [rowsResult]);

  const { mutateAsync: deleteRow } = useDeleteRow();
  const { mutateAsync: updateRow } = useUpdateRow();

  function rowId(row: Record<string, unknown>): string | number {
    // "id" varsa onu kullan, yoksa ilk alanin degerini dene
    const id = row["id"] ?? Object.values(row)[0];
    return id as string | number;
  }

  async function handleDelete(rows: Record<string, unknown>[]) {
    for (const row of rows) {
      await deleteRow({ db, table: selectedTable, id: rowId(row) });
    }
    refetch();
  }

  async function handleCellEdit(
    row: Record<string, unknown>,
    col: string,
    value: unknown
  ) {
    await updateRow({
      db,
      table: selectedTable,
      id: rowId(row),
      data: { [col]: value },
    });
    refetch();
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Tablo secici */}
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-3">
        <Table2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
        {tablesLoading ? (
          <Skeleton className="h-4 w-32" />
        ) : (
          <select
            value={selectedTable}
            onChange={(e) => setSelectedTable(e.target.value)}
            className="rounded bg-zinc-950 px-1 py-0.5 font-mono text-xs text-white outline-none"
          >
            {tables?.map((t) => (
              <option key={t.name} value={t.name} className="bg-zinc-950 text-white">
                {t.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* DataGrid */}
      <div className="min-h-0 flex-1 overflow-hidden">
        {!selectedTable ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            {tablesLoading ? "Tablolar yukleniyor..." : "Tablo yok"}
          </div>
        ) : (
          <DataGrid
            columns={columns}
            data={rowsResult?.rows ?? []}
            total={rowsResult?.total ?? 0}
            page={page}
            pageSize={pageSize}
            isLoading={rowsLoading}
            onPageChange={setPage}
            onPageSizeChange={(s) => {
              setPageSize(s);
              setPage(0);
            }}
            onRefresh={() => refetch()}
            onDelete={handleDelete}
            onCellEdit={handleCellEdit}
          />
        )}
      </div>
    </div>
  );
}

// ── SQL Editor Tab ────────────────────────────────────────────────────────────

const SCHEMA_WIDTH_KEY = "postgrify_dbpage_schema_width";
const RESULTS_HEIGHT_KEY = "postgrify_dbpage_results_pct";

function getSaved(key: string, fallback: number) {
  const raw = localStorage.getItem(key);
  const n = raw ? parseFloat(raw) : NaN;
  return isNaN(n) ? fallback : n;
}

interface QueryResult {
  rows: Record<string, unknown>[];
  count?: number;
}

function SqlEditorTab({ db }: { db: string }) {
  const [selectedTable, setSelectedTable] = React.useState<string>("");
  const [sql, setSql] = React.useState("");
  const [result, setResult] = React.useState<QueryResult | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [duration, setDuration] = React.useState<number | undefined>();
  const [isRunning, setIsRunning] = React.useState(false);

  const [schemaWidth, setSchemaWidth] = React.useState(() =>
    getSaved(SCHEMA_WIDTH_KEY, 240)
  );
  const [resultsPct, setResultsPct] = React.useState(() =>
    getSaved(RESULTS_HEIGHT_KEY, 38)
  );

  const containerRef = React.useRef<HTMLDivElement>(null);

  const { data: tables } = useTables(db);
  const { data: schema } = useTableSchema(db, selectedTable);

  const tableNames = tables?.map((t) => t.name) ?? [];
  const columnNames = React.useMemo(() => {
    if (!schema || !selectedTable) return {};
    return { [selectedTable]: schema.columns.map((c) => c.name) };
  }, [schema, selectedTable]);

  async function runQuery() {
    if (!sql.trim() || isRunning) return;
    setIsRunning(true);
    setError(null);
    setResult(null);
    const t0 = Date.now();
    try {
      const data = await api.post<QueryResult>(`/db/${db}/query`, { sql });
      setResult(data);
      setDuration(Date.now() - t0);
      saveToHistory({ sql: sql.trim(), db, ts: Date.now() });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsRunning(false);
    }
  }

  // Yatay drag (Editor | Schema)
  const isDraggingH = React.useRef(false);
  const dragStartX = React.useRef(0);
  const dragStartWidth = React.useRef(0);

  function onMouseDownH(e: React.MouseEvent) {
    e.preventDefault();
    isDraggingH.current = true;
    dragStartX.current = e.clientX;
    dragStartWidth.current = schemaWidth;
    const onMove = (ev: MouseEvent) => {
      if (!isDraggingH.current) return;
      const delta = dragStartX.current - ev.clientX;
      const newW = Math.max(120, Math.min(500, dragStartWidth.current + delta));
      setSchemaWidth(newW);
      localStorage.setItem(SCHEMA_WIDTH_KEY, String(newW));
    };
    const onUp = () => {
      isDraggingH.current = false;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  // Dikey drag (Ust | Results)
  const isDraggingV = React.useRef(false);
  const dragStartY = React.useRef(0);
  const dragStartPct = React.useRef(0);

  function onMouseDownV(e: React.MouseEvent) {
    e.preventDefault();
    if (!containerRef.current) return;
    isDraggingV.current = true;
    dragStartY.current = e.clientY;
    dragStartPct.current = resultsPct;
    const totalH = containerRef.current.clientHeight;
    const onMove = (ev: MouseEvent) => {
      if (!isDraggingV.current || totalH === 0) return;
      const delta = ev.clientY - dragStartY.current;
      const deltaPct = (delta / totalH) * 100;
      const newPct = Math.max(10, Math.min(80, dragStartPct.current - deltaPct));
      setResultsPct(newPct);
      localStorage.setItem(RESULTS_HEIGHT_KEY, String(newPct));
    };
    const onUp = () => {
      isDraggingV.current = false;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border bg-card px-3 py-2">
        <Select value={selectedTable} onValueChange={setSelectedTable}>
          <SelectTrigger className="h-7 w-36 text-xs">
            <Table2 className="mr-1 h-3 w-3 shrink-0" />
            <SelectValue placeholder="Tablo..." />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="" className="text-xs text-muted-foreground">(tumu)</SelectItem>
            {tables?.map((t) => (
              <SelectItem key={t.name} value={t.name} className="font-mono text-xs">
                {t.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="h-4 w-px bg-border" />

        {isRunning ? (
          <Button size="sm" variant="destructive" onClick={() => setIsRunning(false)} className="gap-1.5">
            <Square className="h-3 w-3" />
            Iptal
          </Button>
        ) : (
          <Button size="sm" onClick={runQuery} disabled={!sql.trim()} className="gap-1.5">
            <Play className="h-3 w-3" />
            Calistir
            <span className="ml-0.5 font-mono text-2xs opacity-50">Ctrl+Enter</span>
          </Button>
        )}

        {duration !== undefined && !error && (
          <span className="ml-auto font-mono text-2xs text-muted-foreground/50">
            {duration}ms
          </span>
        )}
      </div>

      {/* Editor + Schema + Results */}
      <div ref={containerRef} className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {/* Ust: Editor | Schema */}
        <div
          className="flex min-h-0 overflow-hidden"
          style={{ height: `${100 - resultsPct}%` }}
        >
          {/* Editor */}
          <div className="min-w-0 flex-1 overflow-hidden">
            <QueryEditor
              value={sql}
              onChange={setSql}
              onRun={runQuery}
              tableNames={tableNames}
              columnNames={columnNames}
            />
          </div>

          {/* Yatay ayrac */}
          <div
            onMouseDown={onMouseDownH}
            className="w-1 shrink-0 cursor-col-resize bg-border transition-colors hover:bg-zinc-500"
          />

          {/* Schema panel */}
          <div
            className="flex flex-col overflow-hidden border-l border-border bg-card/30"
            style={{ width: schemaWidth }}
          >
            <div className="flex h-7 shrink-0 items-center border-b border-border px-3">
              <span className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground/50">
                Schema
              </span>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {tables?.map((tbl) => (
                <SchemaTableItem
                  key={tbl.name}
                  db={db}
                  name={tbl.name}
                  isSelected={selectedTable === tbl.name}
                  onSelect={() =>
                    setSelectedTable((prev) => (prev === tbl.name ? "" : tbl.name))
                  }
                  onInsertName={(s) => setSql((prev) => prev + s)}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Dikey ayrac */}
        <div
          onMouseDown={onMouseDownV}
          className="h-1 shrink-0 cursor-row-resize bg-border transition-colors hover:bg-zinc-500"
        />

        {/* Results */}
        <div
          className="flex min-h-0 flex-col overflow-hidden border-t border-border"
          style={{ height: `${resultsPct}%` }}
        >
          <ResultsPanel
            rows={result?.rows ?? null}
            rowCount={result?.count}
            duration={duration}
            error={error}
            isRunning={isRunning}
          />
        </div>
      </div>
    </div>
  );
}

function SchemaTableItem({
  db,
  name,
  isSelected,
  onSelect,
  onInsertName,
}: {
  db: string;
  name: string;
  isSelected: boolean;
  onSelect: () => void;
  onInsertName: (s: string) => void;
}) {
  const { data: schema } = useTableSchema(db, isSelected ? name : "");
  const columns = schema?.columns ?? [];

  return (
    <div>
      <button
        onClick={onSelect}
        className={cn(
          "flex w-full items-center gap-1.5 px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent/30",
          isSelected && "bg-accent/20"
        )}
      >
        <ChevronRight
          className={cn(
            "h-3 w-3 shrink-0 text-muted-foreground/40 transition-transform",
            isSelected && "rotate-90"
          )}
        />
        <Table2 className="h-3 w-3 shrink-0 text-muted-foreground/60" />
        <span
          className="flex-1 truncate font-mono text-xs text-foreground/80 hover:text-foreground"
          onClick={(e) => { e.stopPropagation(); onInsertName(name); }}
          title={`"${name}" editore ekle`}
        >
          {name}
        </span>
      </button>

      {isSelected && columns.length > 0 && (
        <div className="ml-5 border-l border-border/40 pb-1">
          {columns.map((col) => (
            <button
              key={col.name}
              onClick={() => onInsertName(col.name)}
              className="flex w-full items-center gap-2 px-2 py-0.5 text-left transition-colors hover:bg-accent/20"
            >
              <span className="flex-1 truncate font-mono text-2xs text-foreground/70">
                {col.name}
              </span>
              <span className="shrink-0 font-mono text-2xs text-muted-foreground/40">
                {col.type}
              </span>
              {col.primary_key && (
                <span className="shrink-0 text-2xs text-amber-500/70">PK</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Placeholder Tab ───────────────────────────────────────────────────────────

function PlaceholderTab({ label, description }: { label: string; description: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
      <div className="flex h-10 w-10 items-center justify-center rounded border border-border bg-card">
        <Clock className="h-5 w-5 text-muted-foreground/40" />
      </div>
      <div>
        <p className="text-sm font-medium text-foreground/80">{label}</p>
        <p className="mt-1 max-w-xs text-xs text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

// ── Options Tab ───────────────────────────────────────────────────────────────

function OptionsTab({ db, dbInfo }: { db: string; dbInfo: DbType | undefined }) {
  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mx-auto max-w-lg space-y-4">
        <h2 className="text-sm font-semibold">Veritabani Secenekleri</h2>
        <div className="rounded border border-border bg-card p-4 text-sm text-muted-foreground">
          <p className="mb-1 font-mono text-xs text-foreground">{db}</p>
          <p className="text-xs">
            Bu bolumden veritabani seviyesinde konfigurasyon yapilabilir.
          </p>
        </div>
        {dbInfo && (
          <div className="space-y-2 text-xs text-muted-foreground">
            {[
              { label: "Boyut", value: formatBytes(dbInfo.size_bytes), accent: "" },
              { label: "Tablo sayisi", value: String(dbInfo.table_count), accent: "" },
              {
                label: "Pool durumu",
                value: dbInfo.pool_active ? "aktif" : "kapali",
                accent: dbInfo.pool_active ? "text-green-400" : "text-red-400",
              },
            ].map((row, i, arr) => (
              <div
                key={row.label}
                className={cn(
                  "flex justify-between",
                  i !== arr.length - 1 && "border-b border-border/40 pb-2"
                )}
              >
                <span>{row.label}</span>
                <span className={cn("font-mono", row.accent)}>{row.value}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
