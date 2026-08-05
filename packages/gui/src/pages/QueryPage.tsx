/**
 * QueryPage — SQL editörü, 3-panel layout.
 *
 * Layout (react-resizable-panels nested yerine CSS flex + manuel drag):
 *
 *  ┌─────────────────────────────────────────┐
 *  │ Toolbar (shrink-0)                      │
 *  ├───────────────────────┬─────────────────┤
 *  │  SQL Editor           │  Schema         │
 *  │  (flex-1)             │  (schemaPct %)  │
 *  │                       │                 │
 *  ├───────────────────────┴─────────────────┤  ← drag handle (dikey)
 *  │  Results Panel (resultsPct %)           │
 *  └─────────────────────────────────────────┘
 *
 * Yatay (editor/schema) ve dikey (üst/results) bölme:
 * - Yatay: schemaPct state (px cinsinden schema genişliği, minimum 160px)
 * - Dikey: resultsPct state (toplam yüksekliğin yüzdesi)
 * - localStorage'a kaydedilir
 */

import React from "react";
import { useLocation } from "react-router-dom";
import { Play, Square, Database as DatabaseIcon, Table2, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryEditor } from "@/components/query-editor/QueryEditor";
import { ResultsPanel } from "@/components/query-editor/ResultsPanel";
import { QueryHistory, saveToHistory } from "@/components/query-editor/QueryHistory";
import { useDatabases } from "@/hooks/useDatabases";
import { useTables, useTableSchema } from "@/hooks/useTables";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

interface QueryResult {
  rows: Record<string, unknown>[];
  count?: number;
}

const SCHEMA_WIDTH_KEY = "postgrify_query_schema_width";
const RESULTS_HEIGHT_KEY = "postgrify_query_results_pct";
const DEFAULT_SCHEMA_WIDTH = 240;
const DEFAULT_RESULTS_PCT = 38;

function getSaved(key: string, fallback: number) {
  const raw = localStorage.getItem(key);
  const n = raw ? parseFloat(raw) : NaN;
  return isNaN(n) ? fallback : n;
}

export default function QueryPage() {
  const location = useLocation();
  const locationState = location.state as { initialSql?: string } | null;

  const { data: databases } = useDatabases();
  const [selectedDb, setSelectedDb] = React.useState<string>("");
  const [selectedTable, setSelectedTable] = React.useState<string>("");
  const [sql, setSql] = React.useState(locationState?.initialSql ?? "");
  const [result, setResult] = React.useState<QueryResult | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [duration, setDuration] = React.useState<number | undefined>();
  const [isRunning, setIsRunning] = React.useState(false);

  // Panel boyutları
  const [schemaWidth, setSchemaWidth] = React.useState(() =>
    getSaved(SCHEMA_WIDTH_KEY, DEFAULT_SCHEMA_WIDTH)
  );
  const [resultsPct, setResultsPct] = React.useState(() =>
    getSaved(RESULTS_HEIGHT_KEY, DEFAULT_RESULTS_PCT)
  );

  const containerRef = React.useRef<HTMLDivElement>(null);

  const { data: tables, isLoading: tablesLoading } = useTables(selectedDb);
  const { data: schema } = useTableSchema(selectedDb, selectedTable);

  React.useEffect(() => {
    if (databases && databases.length > 0 && !selectedDb) {
      setSelectedDb(databases[0].name);
    }
  }, [databases, selectedDb]);

  const tableNames = tables?.map((t) => t.name) ?? [];
  const columnNames = React.useMemo(() => {
    if (!schema || !selectedTable) return {};
    return { [selectedTable]: schema.columns.map((c) => c.name) };
  }, [schema, selectedTable]);

  async function runQuery() {
    if (!sql.trim() || !selectedDb || isRunning) return;
    setIsRunning(true);
    setError(null);
    setResult(null);
    const t0 = Date.now();
    try {
      const data = await api.post<QueryResult>(`/db/${selectedDb}/query`, { sql });
      setResult(data);
      setDuration(Date.now() - t0);
      saveToHistory({ sql: sql.trim(), db: selectedDb, ts: Date.now() });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsRunning(false);
    }
  }

  // ── Yatay drag (Editor | Schema ayraç) ──────────────────────────────────────
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
      const delta = dragStartX.current - ev.clientX; // sola sürükleyince schema büyür
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

  // ── Dikey drag (Üst | Results ayraç) ────────────────────────────────────────
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

      {/* ── Toolbar ─────────────────────────────────────────────────────────── */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border bg-card px-3 py-2">
        <Select value={selectedDb} onValueChange={setSelectedDb}>
          <SelectTrigger className="h-7 w-36 text-xs">
            <DatabaseIcon className="mr-1 h-3 w-3 shrink-0" />
            <SelectValue placeholder="Veritabanı…" />
          </SelectTrigger>
          <SelectContent>
            {databases?.map((db) => (
              <SelectItem key={db.name} value={db.name} className="font-mono text-xs">
                {db.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={selectedTable} onValueChange={setSelectedTable}>
          <SelectTrigger className="h-7 w-36 text-xs">
            <Table2 className="mr-1 h-3 w-3 shrink-0" />
            <SelectValue placeholder="Tablo…" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="" className="text-xs text-muted-foreground">(tümü)</SelectItem>
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
            İptal
          </Button>
        ) : (
          <Button size="sm" onClick={runQuery} disabled={!sql.trim() || !selectedDb} className="gap-1.5">
            <Play className="h-3 w-3" />
            Çalıştır
            <span className="ml-0.5 font-mono text-2xs opacity-50">⌘↵</span>
          </Button>
        )}

        {duration !== undefined && !isRunning && (
          <span className="font-mono text-2xs text-muted-foreground">{duration}ms</span>
        )}

        <div className="flex-1" />
        <QueryHistory onSelect={setSql} />
      </div>

      {/* ── Ana gövde: Üst (Editor+Schema) + Dikey Drag + Results ──────────── */}
      <div ref={containerRef} className="flex min-h-0 flex-1 flex-col overflow-hidden">

        {/* Üst kısım: Editor + Yatay Drag + Schema */}
        <div
          className="flex min-h-0 overflow-hidden"
          style={{ height: `${100 - resultsPct}%` }}
        >
          {/* SQL Editor — flex-1, kalan tüm genişliği kaplar */}
          <div className="min-w-0 flex-1 overflow-hidden">
            <QueryEditor
              value={sql}
              onChange={setSql}
              onRun={runQuery}
              tableNames={tableNames}
              columnNames={columnNames}
              className="h-full"
            />
          </div>

          {/* Yatay drag handle */}
          <div
            onMouseDown={onMouseDownH}
            className="group relative flex w-1 shrink-0 cursor-col-resize flex-col items-center justify-center bg-border transition-colors hover:bg-zinc-500 active:bg-zinc-400"
            title="Sürükle"
          >
            <div className="h-8 w-0.5 rounded-full bg-zinc-600 opacity-0 transition-opacity group-hover:opacity-100" />
          </div>

          {/* Schema paneli — sabit genişlik (px) */}
          <div
            className="flex shrink-0 flex-col overflow-hidden border-l border-border"
            style={{ width: schemaWidth }}
          >
            {/* Schema başlık */}
            <div className="flex h-7 shrink-0 items-center border-b border-border px-3">
              <span className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground/60">
                Schema
              </span>
              {selectedTable && (
                <span className="ml-2 truncate font-mono text-2xs text-muted-foreground">
                  {selectedTable}
                </span>
              )}
            </div>

            {/* Tablo listesi */}
            <div className="min-h-0 flex-1 overflow-y-auto py-1">
              {tablesLoading ? (
                <div className="space-y-1 p-2">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Skeleton key={i} className="h-6 w-full" />
                  ))}
                </div>
              ) : tables && tables.length > 0 ? (
                tables.map((tbl) => (
                  <SchemaTableRow
                    key={tbl.name}
                    name={tbl.name}
                    isSelected={tbl.name === selectedTable}
                    onSelect={() =>
                      setSelectedTable((prev) => (prev === tbl.name ? "" : tbl.name))
                    }
                    columns={tbl.name === selectedTable ? (schema?.columns ?? []) : []}
                    onInsertName={(name) => setSql((prev) => prev + name)}
                  />
                ))
              ) : (
                <div className="px-3 py-4 text-center text-xs text-muted-foreground">
                  {selectedDb ? "Tablo yok" : "Veritabanı seçin"}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Dikey drag handle (üst/results ayraç) */}
        <div
          onMouseDown={onMouseDownV}
          className="group relative flex h-1 shrink-0 cursor-row-resize items-center justify-center bg-border transition-colors hover:bg-zinc-500 active:bg-zinc-400"
          title="Sürükle"
        >
          <div className="h-0.5 w-8 rounded-full bg-zinc-600 opacity-0 transition-opacity group-hover:opacity-100" />
        </div>

        {/* Results paneli */}
        <div
          className="flex min-h-0 flex-col overflow-hidden"
          style={{ height: `${resultsPct}%` }}
        >
          <div className="flex h-7 shrink-0 items-center gap-2 border-b border-border px-3">
            <span className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground/60">
              Results
            </span>
            {result && (
              <span className="font-mono text-2xs text-muted-foreground">
                {result.count ?? result.rows.length} satır
              </span>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-hidden">
            <ResultsPanel
              rows={result?.rows ?? null}
              error={error}
              rowCount={result?.count ?? result?.rows.length}
              duration={duration}
              isRunning={isRunning}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

// ── SchemaTableRow ────────────────────────────────────────────────────────────

function SchemaTableRow({
  name,
  isSelected,
  onSelect,
  columns,
  onInsertName,
}: {
  name: string;
  isSelected: boolean;
  onSelect: () => void;
  columns: Array<{ name: string; type: string; primary_key: boolean; nullable: string }>;
  onInsertName: (s: string) => void;
}) {
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
          onClick={(e) => {
            e.stopPropagation();
            onInsertName(name);
          }}
          title={`"${name}" editöre ekle`}
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
              title={`"${col.name}" editöre ekle`}
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