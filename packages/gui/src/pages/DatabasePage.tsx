/**
 * DatabasePage — Proxmox tarzı DB detay sayfası.
 *
 * Sol: dikey sekme nav (Summary, Tables & Schema, Data, SQL Editor, Options)
 * Sag: secilen sekmenin icerigi
 *
 * URL: /databases/:db   ?tab=summary|tables|data|query|options
 */

import React from "react";
import { useParams, useSearchParams, Link, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  Table2,
  Rows3,
  Terminal,
  Settings2,
  Loader2,
  Play,
  Database,
  HardDrive,
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
import { useDatabases, useDeleteDatabase } from "@/hooks/useDatabases";
import { useTables, useTableSchema, useDropTable } from "@/hooks/useTables";
import { useRows, useDeleteRow, useUpdateRow } from "@/hooks/useRows";
import { useDbAuthUsers } from "@/hooks/useDbAuth";
import type { Database as DbType } from "@/types";
import { DataGrid } from "@/components/data-grid/DataGrid";
import type { DataGridColumn } from "@/components/data-grid/DataGrid";
import { QueryEditor } from "@/components/query-editor/QueryEditor";
import { ResultsPanel } from "@/components/query-editor/ResultsPanel";
import { saveToHistory } from "@/components/query-editor/QueryHistory";
import { api, BASE_URL, getToken } from "@/lib/api";
import { AuthsTab } from "@/components/database/AuthsTab";

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

// ── Ana bilesen ───────────────────────────────────────────────────────────────

export default function DatabasePage() {
  const { db } = useParams<{ db: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab   = (searchParams.get("tab") as TabId) ?? "summary";
  const activeTable = searchParams.get("table") ?? "";

  const { data: databases, isLoading: dbLoading } = useDatabases();
  const dbInfo: DbType | undefined = databases?.find((d) => d.name === db);

  if (!db) return null;

  function setTab(id: TabId) {
    setSearchParams({ tab: id });
  }

  function setTable(name: string) {
    setSearchParams({ tab: "data", table: name });
  }

  return (
    <div className="flex h-full overflow-hidden">

      {/* Sol sekme nav */}
      <div className="flex w-52 shrink-0 flex-col border-r border-border bg-card">
        {/* DB baslik */}
        <div className="flex h-10 items-center gap-2 border-b border-border px-3">
          <Database className="h-4 w-4 shrink-0 text-muted-foreground" />
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
        <div className="flex h-10 shrink-0 items-center border-b border-border px-4">
          <span className="font-mono text-sm font-semibold">{db}</span>
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
            <SummaryTab db={db} dbInfo={dbInfo} />
          ) : activeTab === "tables" ? (
            <TablesTab db={db} />
          ) : activeTab === "data" ? (
            <DataTab db={db} activeTable={activeTable} setTable={setTable} />
          ) : activeTab === "query" ? (
            <SqlEditorTab db={db} />
          ) : activeTab === "backup" ? (
            <BackupTab db={db} />
          ) : activeTab === "auths" ? (
            <AuthsTab db={db} />
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
}: {
  db: string;
  dbInfo: DbType | undefined;
}) {
  const stats = [
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

const AUTH_SCHEMA = "_postgrify_auth";
const AUTH_TABLES = ["users", "sessions"] as const;

function DataTab({
  db,
  activeTable,
  setTable,
}: {
  db: string;
  activeTable: string;
  setTable: (name: string) => void;
}) {
  const { data: tables, isLoading: tablesLoading } = useTables(db);
  const [page, setPage] = React.useState(0);
  const [pageSize, setPageSize] = React.useState(25);

  // URL'den seçili tablo gelmiyorsa ilk public tabloyu otomatik seç
  React.useEffect(() => {
    if (!activeTable && tables && tables.length > 0) {
      setTable(tables[0].name);
    }
  }, [activeTable, tables, setTable]);

  // Tablo değişince sayfa sıfırla
  React.useEffect(() => { setPage(0); }, [activeTable]);

  // "schema.table" parse — auth tabloları için
  const isAuthTable =
    activeTable.startsWith(AUTH_SCHEMA + ".") ||
    AUTH_TABLES.includes(activeTable.replace(AUTH_SCHEMA + ".", "") as typeof AUTH_TABLES[number]);
  const resolvedSchema = activeTable.startsWith(AUTH_SCHEMA + ".") ? AUTH_SCHEMA : "public";
  const resolvedTable  = activeTable.startsWith(AUTH_SCHEMA + ".")
    ? activeTable.slice(AUTH_SCHEMA.length + 1)
    : activeTable;

  // Public table rows
  const { data: rowsResult, isLoading: rowsLoading, refetch } = useRows(
    db,
    isAuthTable ? "" : resolvedTable,       // auth tablosu seçiliyse public hook devre dışı
    { limit: pageSize, offset: page * pageSize }
  );

  // Auth users (sadece _postgrify_auth.users için)
  const {
    data: authUsersResult,
    isLoading: authUsersLoading,
    refetch: refetchAuthUsers,
  } = useDbAuthUsers(isAuthTable && resolvedTable === "users" ? db : "");

  // Auth rows → DataGrid formatına normalize et
  const authRows: Record<string, unknown>[] = React.useMemo(
    () => (authUsersResult?.users ?? []) as unknown as Record<string, unknown>[],
    [authUsersResult]
  );

  // Aktif veri + loading + refetch
  const activeRows    = isAuthTable ? authRows               : (rowsResult?.rows ?? []);
  const activeTotal   = isAuthTable ? (authUsersResult?.total ?? 0) : (rowsResult?.total ?? 0);
  const activeLoading = isAuthTable ? authUsersLoading        : rowsLoading;
  function activeRefetch() {
    if (isAuthTable) { refetchAuthUsers(); } else { refetch(); }
  }

  const columns: DataGridColumn[] = React.useMemo(() => {
    if (!activeRows.length) return [];
    return Object.keys(activeRows[0]).map((key) => ({
      key,
      label: key,
      type: "text" as const,
    }));
  }, [activeRows]);

  const { mutateAsync: deleteRow } = useDeleteRow();
  const { mutateAsync: updateRow } = useUpdateRow();

  function rowId(row: Record<string, unknown>): string | number {
    const id = row["id"] ?? Object.values(row)[0];
    return id as string | number;
  }

  async function handleDelete(rows: Record<string, unknown>[]) {
    for (const row of rows) {
      await deleteRow({ db, table: resolvedTable, id: rowId(row) });
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
      table: resolvedTable,
      id: rowId(row),
      data: { [col]: value },
    });
    refetch();
  }

  const publicTableNames = tables?.map((t) => t.name) ?? [];

  return (
    <div className="flex h-full overflow-hidden">
      {/* ── Sol panel: tablo listesi ── */}
      <div className="flex w-48 shrink-0 flex-col border-r border-border bg-muted/10">
        <div className="flex h-9 items-center border-b border-border px-3">
          <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Tablolar
          </span>
        </div>

        <div className="flex-1 overflow-y-auto py-1">
          {tablesLoading ? (
            <div className="flex flex-col gap-1.5 px-2 py-2">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-6 w-full rounded" />)}
            </div>
          ) : (
            <>
              {/* PUBLIC grubu */}
              {publicTableNames.length > 0 && (
                <div>
                  <div className="px-3 pb-0.5 pt-2">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/50">
                      public
                    </span>
                  </div>
                  {publicTableNames.map((name) => (
                    <button
                      key={name}
                      onClick={() => setTable(name)}
                      className={cn(
                        "flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors",
                        activeTable === name
                          ? "bg-accent/10 font-medium text-foreground"
                          : "text-muted-foreground hover:bg-muted/40 hover:text-foreground"
                      )}
                    >
                      <Table2 className="h-3 w-3 shrink-0 opacity-60" />
                      <span className="truncate font-mono">{name}</span>
                    </button>
                  ))}
                </div>
              )}

              {/* _POSTGRIFY_AUTH grubu */}
              <div>
                <div className="px-3 pb-0.5 pt-3">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/50">
                    _postgrify_auth
                  </span>
                </div>
                {AUTH_TABLES.map((name) => {
                  const fullName = `${AUTH_SCHEMA}.${name}`;
                  return (
                    <button
                      key={fullName}
                      onClick={() => setTable(fullName)}
                      className={cn(
                        "flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors",
                        activeTable === fullName
                          ? "bg-accent/10 font-medium text-foreground"
                          : "text-muted-foreground hover:bg-muted/40 hover:text-foreground"
                      )}
                    >
                      <KeyRound className="h-3 w-3 shrink-0 opacity-60" />
                      <span className="truncate font-mono">{name}</span>
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Sağ panel: veri grid ── */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {/* Tablo başlığı */}
        {activeTable && (
          <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-3">
            {isAuthTable
              ? <KeyRound className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
              : <Table2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
            }
            <span className="font-mono text-xs text-muted-foreground">
              {resolvedSchema !== "public" && (
                <span className="text-muted-foreground/50">{resolvedSchema}.</span>
              )}
              <span className="text-foreground">{resolvedTable}</span>
            </span>
            {isAuthTable && (
              <span className="ml-1 rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-500">
                auth
              </span>
            )}
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-hidden">
          {!activeTable ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              {tablesLoading ? "Tablolar yükleniyor…" : "Bir tablo seçin"}
            </div>
          ) : (
            <DataGrid
              columns={columns}
              data={activeRows}
              total={activeTotal}
              page={page}
              pageSize={pageSize}
              isLoading={activeLoading}
              onPageChange={setPage}
              onPageSizeChange={(s) => { setPageSize(s); setPage(0); }}
              onRefresh={activeRefetch}
              onDelete={isAuthTable ? undefined : handleDelete}
              onCellEdit={isAuthTable ? undefined : handleCellEdit}
              db={db}
              tableName={resolvedTable}
            />
          )}
        </div>
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


// ── Backup Tab ────────────────────────────────────────────────────────────────

function BackupTab({ db }: { db: string }) {
  const { data: tables } = useTables(db);
  const { data: databases } = useDatabases();
  const dbInfo = databases?.find((d) => d.name === db);
  const [isDownloading, setIsDownloading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [lastDownload, setLastDownload] = React.useState<string | null>(null);

  async function handleDownload() {
    setIsDownloading(true);
    setError(null);
    try {
      const token = getToken();
      const res = await fetch(`${BASE_URL}/db/${db}/backup/download`, {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string; message?: string };
        throw new Error(err.error ?? err.message ?? `HTTP ${res.status}`);
      }

      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      const now  = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      a.href     = url;
      a.download = `${db}_${now}.sql`;
      a.click();
      URL.revokeObjectURL(url);

      setLastDownload(new Date().toLocaleString("tr-TR"));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsDownloading(false);
    }
  }

  const tableCount = tables?.length ?? 0;
  const dbSize     = dbInfo?.size_bytes ? formatBytes(dbInfo.size_bytes) : "—";

  return (
    <div className="flex h-full items-start justify-center overflow-y-auto p-8">
      <div className="w-full max-w-md space-y-6">
        {/* Başlık */}
        <div>
          <h2 className="text-base font-semibold">Backup</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Veritabanının SQL dump'ını indirin. DDL (CREATE TABLE) ve DML (INSERT) ifadelerini içerir.
          </p>
        </div>

        {/* DB Bilgisi */}
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="grid grid-cols-3 divide-x divide-border text-center">
            <div className="px-3">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Veritabanı</p>
              <p className="mt-1 font-mono text-sm font-medium">{db}</p>
            </div>
            <div className="px-3">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Tablolar</p>
              <p className="mt-1 text-sm font-medium">{tableCount}</p>
            </div>
            <div className="px-3">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Boyut</p>
              <p className="mt-1 text-sm font-medium">{dbSize}</p>
            </div>
          </div>
        </div>

        {/* Download Kartı */}
        <div className="rounded-lg border border-border bg-card p-5 space-y-4">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded border border-border bg-muted/30">
              <Archive className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">SQL Dump</p>
              <p className="text-xs text-muted-foreground">
                Public schema — CREATE TABLE + INSERT INTO ifadeleri.
                Sadece veri; view, index, foreign key dahil değil.
              </p>
            </div>
          </div>

          {error && (
            <div className="rounded border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          )}

          {lastDownload && !error && (
            <p className="text-xs text-muted-foreground">
              Son indirme: {lastDownload}
            </p>
          )}

          <Button
            onClick={handleDownload}
            disabled={isDownloading}
            className="w-full"
          >
            {isDownloading ? (
              <>
                <span className="mr-2 h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                Hazırlanıyor…
              </>
            ) : (
              <>
                <Archive className="mr-2 h-3.5 w-3.5" />
                Download SQL Backup
              </>
            )}
          </Button>
        </div>

        {/* Uyarı */}
        <p className="text-center text-xs text-muted-foreground/60">
          Bu dump yalnızca geliştirme ve test ortamları içindir.
          Üretim yedeklemesi için <code className="text-muted-foreground">pg_dump</code> kullanın.
        </p>
      </div>
    </div>
  );
}

// ── Options Tab ───────────────────────────────────────────────────────────────

function OptionsTab({ db, dbInfo }: { db: string; dbInfo: DbType | undefined }) {
  const { mutateAsync: deleteDatabase, isPending: deleting } = useDeleteDatabase();
  const [deleteConfirm, setDeleteConfirm] = React.useState(false);
  const [deleteInput, setDeleteInput] = React.useState("");
  const navigate = useNavigate();

  async function handleDelete() {
    if (deleteInput !== db) return;
    await deleteDatabase(db);
    navigate("/databases");
  }

  const stats = dbInfo
    ? [
        { label: "Boyut", value: formatBytes(dbInfo.size_bytes), accent: "" },
        { label: "Tablo sayisi", value: String(dbInfo.table_count), accent: "" },
      ]
    : [];

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mx-auto max-w-lg space-y-6">
        <h2 className="text-sm font-semibold">Veritabani Secenekleri</h2>

        {/* Info kartı */}
        <div className="rounded border border-border bg-card p-4">
          <p className="mb-1 font-mono text-xs text-foreground">{db}</p>
          <div className="mt-3 space-y-2 text-xs text-muted-foreground">
            {stats.map((row, i, arr) => (
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
        </div>

        {/* Delete Zone */}
        <div className="rounded border border-red-900/40 bg-card p-4">
          <p className="mb-1 text-xs font-medium text-red-400">Tehlikeli Bölge</p>
          <p className="mb-3 text-xs text-muted-foreground">
            Bu işlem geri alınamaz. Veritabanı ve tüm verileri kalıcı olarak silinir.
          </p>
          {!deleteConfirm ? (
            <Button
              size="sm"
              variant="destructive"
              onClick={() => setDeleteConfirm(true)}
              className="gap-1.5"
            >
              Veritabanını Sil
            </Button>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                Onaylamak için veritabanı adını yazın:{" "}
                <span className="font-mono text-foreground">{db}</span>
              </p>
              <input
                type="text"
                value={deleteInput}
                onChange={(e) => setDeleteInput(e.target.value)}
                placeholder={db}
                className="h-8 w-full rounded border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-red-500"
              />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={handleDelete}
                  disabled={deleteInput !== db || deleting}
                  className="gap-1.5"
                >
                  {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                  Kalıcı Olarak Sil
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => { setDeleteConfirm(false); setDeleteInput(""); }}
                >
                  İptal
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
