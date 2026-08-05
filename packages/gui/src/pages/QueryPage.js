import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
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
const SCHEMA_WIDTH_KEY = "postgrify_query_schema_width";
const RESULTS_HEIGHT_KEY = "postgrify_query_results_pct";
const DEFAULT_SCHEMA_WIDTH = 240;
const DEFAULT_RESULTS_PCT = 38;
function getSaved(key, fallback) {
    const raw = localStorage.getItem(key);
    const n = raw ? parseFloat(raw) : NaN;
    return isNaN(n) ? fallback : n;
}
export default function QueryPage() {
    const location = useLocation();
    const locationState = location.state;
    const { data: databases } = useDatabases();
    const [selectedDb, setSelectedDb] = React.useState("");
    const [selectedTable, setSelectedTable] = React.useState("");
    const [sql, setSql] = React.useState(locationState?.initialSql ?? "");
    const [result, setResult] = React.useState(null);
    const [error, setError] = React.useState(null);
    const [duration, setDuration] = React.useState();
    const [isRunning, setIsRunning] = React.useState(false);
    // Panel boyutları
    const [schemaWidth, setSchemaWidth] = React.useState(() => getSaved(SCHEMA_WIDTH_KEY, DEFAULT_SCHEMA_WIDTH));
    const [resultsPct, setResultsPct] = React.useState(() => getSaved(RESULTS_HEIGHT_KEY, DEFAULT_RESULTS_PCT));
    const containerRef = React.useRef(null);
    const { data: tables, isLoading: tablesLoading } = useTables(selectedDb);
    const { data: schema } = useTableSchema(selectedDb, selectedTable);
    React.useEffect(() => {
        if (databases && databases.length > 0 && !selectedDb) {
            setSelectedDb(databases[0].name);
        }
    }, [databases, selectedDb]);
    const tableNames = tables?.map((t) => t.name) ?? [];
    const columnNames = React.useMemo(() => {
        if (!schema || !selectedTable)
            return {};
        return { [selectedTable]: schema.columns.map((c) => c.name) };
    }, [schema, selectedTable]);
    async function runQuery() {
        if (!sql.trim() || !selectedDb || isRunning)
            return;
        setIsRunning(true);
        setError(null);
        setResult(null);
        const t0 = Date.now();
        try {
            const data = await api.post(`/db/${selectedDb}/query`, { sql });
            setResult(data);
            setDuration(Date.now() - t0);
            saveToHistory({ sql: sql.trim(), db: selectedDb, ts: Date.now() });
        }
        catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        }
        finally {
            setIsRunning(false);
        }
    }
    // ── Yatay drag (Editor | Schema ayraç) ──────────────────────────────────────
    const isDraggingH = React.useRef(false);
    const dragStartX = React.useRef(0);
    const dragStartWidth = React.useRef(0);
    function onMouseDownH(e) {
        e.preventDefault();
        isDraggingH.current = true;
        dragStartX.current = e.clientX;
        dragStartWidth.current = schemaWidth;
        const onMove = (ev) => {
            if (!isDraggingH.current)
                return;
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
    function onMouseDownV(e) {
        e.preventDefault();
        if (!containerRef.current)
            return;
        isDraggingV.current = true;
        dragStartY.current = e.clientY;
        dragStartPct.current = resultsPct;
        const totalH = containerRef.current.clientHeight;
        const onMove = (ev) => {
            if (!isDraggingV.current || totalH === 0)
                return;
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
    return (_jsxs("div", { className: "flex h-full flex-col overflow-hidden", children: [_jsxs("div", { className: "flex shrink-0 items-center gap-2 border-b border-border bg-card px-3 py-2", children: [_jsxs(Select, { value: selectedDb, onValueChange: setSelectedDb, children: [_jsxs(SelectTrigger, { className: "h-7 w-36 text-xs", children: [_jsx(DatabaseIcon, { className: "mr-1 h-3 w-3 shrink-0" }), _jsx(SelectValue, { placeholder: "Veritaban\u0131\u2026" })] }), _jsx(SelectContent, { children: databases?.map((db) => (_jsx(SelectItem, { value: db.name, className: "font-mono text-xs", children: db.name }, db.name))) })] }), _jsxs(Select, { value: selectedTable, onValueChange: setSelectedTable, children: [_jsxs(SelectTrigger, { className: "h-7 w-36 text-xs", children: [_jsx(Table2, { className: "mr-1 h-3 w-3 shrink-0" }), _jsx(SelectValue, { placeholder: "Tablo\u2026" })] }), _jsxs(SelectContent, { children: [_jsx(SelectItem, { value: "", className: "text-xs text-muted-foreground", children: "(t\u00FCm\u00FC)" }), tables?.map((t) => (_jsx(SelectItem, { value: t.name, className: "font-mono text-xs", children: t.name }, t.name)))] })] }), _jsx("div", { className: "h-4 w-px bg-border" }), isRunning ? (_jsxs(Button, { size: "sm", variant: "destructive", onClick: () => setIsRunning(false), className: "gap-1.5", children: [_jsx(Square, { className: "h-3 w-3" }), "\u0130ptal"] })) : (_jsxs(Button, { size: "sm", onClick: runQuery, disabled: !sql.trim() || !selectedDb, className: "gap-1.5", children: [_jsx(Play, { className: "h-3 w-3" }), "\u00C7al\u0131\u015Ft\u0131r", _jsx("span", { className: "ml-0.5 font-mono text-2xs opacity-50", children: "\u2318\u21B5" })] })), duration !== undefined && !isRunning && (_jsxs("span", { className: "font-mono text-2xs text-muted-foreground", children: [duration, "ms"] })), _jsx("div", { className: "flex-1" }), _jsx(QueryHistory, { onSelect: setSql })] }), _jsxs("div", { ref: containerRef, className: "flex min-h-0 flex-1 flex-col overflow-hidden", children: [_jsxs("div", { className: "flex min-h-0 overflow-hidden", style: { height: `${100 - resultsPct}%` }, children: [_jsx("div", { className: "min-w-0 flex-1 overflow-hidden", children: _jsx(QueryEditor, { value: sql, onChange: setSql, onRun: runQuery, tableNames: tableNames, columnNames: columnNames, className: "h-full" }) }), _jsx("div", { onMouseDown: onMouseDownH, className: "group relative flex w-1 shrink-0 cursor-col-resize flex-col items-center justify-center bg-border transition-colors hover:bg-zinc-500 active:bg-zinc-400", title: "S\u00FCr\u00FCkle", children: _jsx("div", { className: "h-8 w-0.5 rounded-full bg-zinc-600 opacity-0 transition-opacity group-hover:opacity-100" }) }), _jsxs("div", { className: "flex shrink-0 flex-col overflow-hidden border-l border-border", style: { width: schemaWidth }, children: [_jsxs("div", { className: "flex h-7 shrink-0 items-center border-b border-border px-3", children: [_jsx("span", { className: "text-2xs font-semibold uppercase tracking-wider text-muted-foreground/60", children: "Schema" }), selectedTable && (_jsx("span", { className: "ml-2 truncate font-mono text-2xs text-muted-foreground", children: selectedTable }))] }), _jsx("div", { className: "min-h-0 flex-1 overflow-y-auto py-1", children: tablesLoading ? (_jsx("div", { className: "space-y-1 p-2", children: Array.from({ length: 5 }).map((_, i) => (_jsx(Skeleton, { className: "h-6 w-full" }, i))) })) : tables && tables.length > 0 ? (tables.map((tbl) => (_jsx(SchemaTableRow, { name: tbl.name, isSelected: tbl.name === selectedTable, onSelect: () => setSelectedTable((prev) => (prev === tbl.name ? "" : tbl.name)), columns: tbl.name === selectedTable ? (schema?.columns ?? []) : [], onInsertName: (name) => setSql((prev) => prev + name) }, tbl.name)))) : (_jsx("div", { className: "px-3 py-4 text-center text-xs text-muted-foreground", children: selectedDb ? "Tablo yok" : "Veritabanı seçin" })) })] })] }), _jsx("div", { onMouseDown: onMouseDownV, className: "group relative flex h-1 shrink-0 cursor-row-resize items-center justify-center bg-border transition-colors hover:bg-zinc-500 active:bg-zinc-400", title: "S\u00FCr\u00FCkle", children: _jsx("div", { className: "h-0.5 w-8 rounded-full bg-zinc-600 opacity-0 transition-opacity group-hover:opacity-100" }) }), _jsxs("div", { className: "flex min-h-0 flex-col overflow-hidden", style: { height: `${resultsPct}%` }, children: [_jsxs("div", { className: "flex h-7 shrink-0 items-center gap-2 border-b border-border px-3", children: [_jsx("span", { className: "text-2xs font-semibold uppercase tracking-wider text-muted-foreground/60", children: "Results" }), result && (_jsxs("span", { className: "font-mono text-2xs text-muted-foreground", children: [result.count ?? result.rows.length, " sat\u0131r"] }))] }), _jsx("div", { className: "min-h-0 flex-1 overflow-hidden", children: _jsx(ResultsPanel, { rows: result?.rows ?? null, error: error, rowCount: result?.count ?? result?.rows.length, duration: duration, isRunning: isRunning }) })] })] })] }));
}
// ── SchemaTableRow ────────────────────────────────────────────────────────────
function SchemaTableRow({ name, isSelected, onSelect, columns, onInsertName, }) {
    return (_jsxs("div", { children: [_jsxs("button", { onClick: onSelect, className: cn("flex w-full items-center gap-1.5 px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent/30", isSelected && "bg-accent/20"), children: [_jsx(ChevronRight, { className: cn("h-3 w-3 shrink-0 text-muted-foreground/40 transition-transform", isSelected && "rotate-90") }), _jsx(Table2, { className: "h-3 w-3 shrink-0 text-muted-foreground/60" }), _jsx("span", { className: "flex-1 truncate font-mono text-xs text-foreground/80 hover:text-foreground", onClick: (e) => {
                            e.stopPropagation();
                            onInsertName(name);
                        }, title: `"${name}" editöre ekle`, children: name })] }), isSelected && columns.length > 0 && (_jsx("div", { className: "ml-5 border-l border-border/40 pb-1", children: columns.map((col) => (_jsxs("button", { onClick: () => onInsertName(col.name), className: "flex w-full items-center gap-2 px-2 py-0.5 text-left transition-colors hover:bg-accent/20", title: `"${col.name}" editöre ekle`, children: [_jsx("span", { className: "flex-1 truncate font-mono text-2xs text-foreground/70", children: col.name }), _jsx("span", { className: "shrink-0 font-mono text-2xs text-muted-foreground/40", children: col.type }), col.primary_key && (_jsx("span", { className: "shrink-0 text-2xs text-amber-500/70", children: "PK" }))] }, col.name))) }))] }));
}
