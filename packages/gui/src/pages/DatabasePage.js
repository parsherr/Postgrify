import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
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
import { LayoutDashboard, Table2, Rows3, Code2, Settings2, Loader2, Play, Database, HardDrive, Hash, ChevronRight, Copy, Check, Archive, KeyRound, Square, Shield, } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn, formatBytes } from "@/lib/utils";
import { useDatabases, useDeleteDatabase } from "@/hooks/useDatabases";
import { useTables, useTableSchema, useDropTable } from "@/hooks/useTables";
import { useRows, useDeleteRow, useUpdateRow } from "@/hooks/useRows";
import { useDbAuthUsers } from "@/hooks/useDbAuth";
import { DataGrid } from "@/components/data-grid/DataGrid";
import { QueryEditor } from "@/components/query-editor/QueryEditor";
import { ResultsPanel } from "@/components/query-editor/ResultsPanel";
import { saveToHistory } from "@/components/query-editor/QueryHistory";
import { api } from "@/lib/api";
import { AuthsTab } from "@/components/database/AuthsTab";
import { BackupTab } from "@/components/database/BackupTab";
import { ConnectionsTab } from "@/components/database/ConnectionsTab";
// ── Sekme tanimlari ──────────────────────────────────────────────────────────
const TABS = [
    { id: "summary", label: "Summary", icon: LayoutDashboard },
    { id: "tables", label: "Tables & Schema", icon: Table2 },
    { id: "data", label: "Data", icon: Rows3 },
    { id: "query", label: "SQL Editor", icon: Code2 },
    { id: "backup", label: "Backup", icon: Archive },
    { id: "auths", label: "Auths", icon: KeyRound },
    { id: "connections", label: "Connections", icon: Shield },
    { id: "options", label: "Database Options", icon: Settings2 },
];
// ── Ana bilesen ───────────────────────────────────────────────────────────────
export default function DatabasePage() {
    const { db } = useParams();
    const [searchParams, setSearchParams] = useSearchParams();
    const activeTab = searchParams.get("tab") ?? "summary";
    const activeTable = searchParams.get("table") ?? "";
    const { data: databases, isLoading: dbLoading } = useDatabases();
    const dbInfo = databases?.find((d) => d.name === db);
    if (!db)
        return null;
    function setTab(id) {
        setSearchParams({ tab: id });
    }
    function setTable(name) {
        setSearchParams({ tab: "data", table: name });
    }
    return (_jsxs("div", { className: "flex h-full overflow-hidden", children: [_jsxs("div", { className: "flex w-52 shrink-0 flex-col border-r border-border bg-card", children: [_jsxs("div", { className: "flex h-10 items-center gap-2 border-b border-border px-3", children: [_jsx(Database, { className: "h-4 w-4 shrink-0 text-muted-foreground" }), _jsx("span", { className: "truncate font-mono text-sm font-semibold", children: db })] }), _jsx("nav", { className: "flex-1 py-2", children: TABS.map(({ id, label, icon: Icon }) => (_jsxs("button", { onClick: () => setTab(id), className: cn("flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs transition-colors", activeTab === id
                                ? "bg-accent text-foreground"
                                : "text-muted-foreground hover:bg-accent/40 hover:text-foreground"), children: [_jsx(Icon, { className: "h-3.5 w-3.5 shrink-0" }), label] }, id))) }), _jsx("div", { className: "border-t border-border p-2", children: _jsxs(Link, { to: "/databases", className: "flex items-center gap-1.5 rounded px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent/30 hover:text-foreground", children: [_jsx(ChevronRight, { className: "h-3 w-3 rotate-180" }), "Veritabanlari"] }) })] }), _jsxs("div", { className: "flex min-w-0 flex-1 flex-col overflow-hidden", children: [_jsx("div", { className: "flex h-10 shrink-0 items-center border-b border-border px-4", children: _jsx("span", { className: "font-mono text-sm font-semibold", children: db }) }), _jsx("div", { className: "min-h-0 flex-1 overflow-hidden", children: dbLoading ? (_jsx("div", { className: "space-y-3 p-6", children: Array.from({ length: 4 }).map((_, i) => (_jsx(Skeleton, { className: "h-8 w-full" }, i))) })) : activeTab === "summary" ? (_jsx(SummaryTab, { db: db, dbInfo: dbInfo })) : activeTab === "tables" ? (_jsx(TablesTab, { db: db })) : activeTab === "data" ? (_jsx(DataTab, { db: db, activeTable: activeTable, setTable: setTable })) : activeTab === "query" ? (_jsx(SqlEditorTab, { db: db })) : activeTab === "backup" ? (_jsx(BackupTab, { db: db })) : activeTab === "auths" ? (_jsx(AuthsTab, { db: db })) : activeTab === "connections" ? (_jsx(ConnectionsTab, { db: db })) : (_jsx(OptionsTab, { db: db, dbInfo: dbInfo })) })] })] }));
}
// ── Summary Tab ──────────────────────────────────────────────────────────────
function SummaryTab({ db, dbInfo, }) {
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
    return (_jsx("div", { className: "h-full overflow-y-auto p-6", children: _jsxs("div", { className: "mx-auto max-w-2xl space-y-6", children: [_jsx("div", { className: "overflow-hidden rounded border border-border bg-card", children: stats.map((stat, i) => {
                        const Icon = stat.icon;
                        return (_jsxs("div", { className: cn("flex items-center justify-between px-4 py-3", i !== stats.length - 1 && "border-b border-border/50"), children: [_jsxs("div", { className: "flex items-center gap-2.5 text-sm text-muted-foreground", children: [_jsx(Icon, { className: "h-3.5 w-3.5 shrink-0" }), stat.label] }), _jsx("span", { className: cn("font-mono text-sm font-medium", stat.accent), children: stat.value })] }, stat.label));
                    }) }), _jsxs("div", { className: "rounded border border-border bg-card p-4", children: [_jsx("h3", { className: "mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground/60", children: "Baglanti" }), _jsx("div", { className: "font-mono text-xs text-muted-foreground", children: _jsxs("span", { className: "text-foreground/60", children: ["postgresql://.../", db] }) })] })] }) }));
}
// ── Tables & Schema Tab ───────────────────────────────────────────────────────
function TablesTab({ db }) {
    const { data: tables, isLoading } = useTables(db);
    const [selectedTable, setSelectedTable] = React.useState(null);
    const { data: schema, isLoading: schemaLoading } = useTableSchema(db, selectedTable ?? "");
    const { mutateAsync: dropTable, isPending: dropping } = useDropTable();
    const [copied, setCopied] = React.useState(false);
    const ddl = React.useMemo(() => {
        if (!schema)
            return "";
        const cols = schema.columns
            .map((c) => {
            let def = `  "${c.name}" ${c.type}`;
            if (c.primary_key)
                def += " PRIMARY KEY";
            if (c.nullable === "NO" && !c.primary_key)
                def += " NOT NULL";
            if (c.default)
                def += ` DEFAULT ${c.default}`;
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
    return (_jsxs("div", { className: "flex h-full overflow-hidden", children: [_jsxs("div", { className: "w-56 shrink-0 overflow-y-auto border-r border-border bg-card/50", children: [_jsxs("div", { className: "flex h-7 items-center border-b border-border px-3", children: [_jsx("span", { className: "text-2xs font-semibold uppercase tracking-wider text-muted-foreground/50", children: "Tablolar" }), tables && (_jsx("span", { className: "ml-auto font-mono text-2xs text-muted-foreground/40", children: tables.length }))] }), _jsx("div", { className: "py-1", children: isLoading
                            ? Array.from({ length: 5 }).map((_, i) => (_jsx(Skeleton, { className: "mx-2 my-1 h-6" }, i)))
                            : tables?.map((tbl) => (_jsxs("button", { onClick: () => setSelectedTable(tbl.name), className: cn("flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors", selectedTable === tbl.name
                                    ? "bg-accent text-foreground"
                                    : "text-muted-foreground hover:bg-accent/30 hover:text-foreground"), children: [_jsx(Table2, { className: "h-3 w-3 shrink-0 text-muted-foreground/50" }), _jsx("span", { className: "flex-1 truncate font-mono", children: tbl.name })] }, tbl.name))) })] }), _jsx("div", { className: "flex min-w-0 flex-1 flex-col overflow-hidden", children: !selectedTable ? (_jsx("div", { className: "flex h-full items-center justify-center text-sm text-muted-foreground", children: "Bir tablo secin" })) : schemaLoading ? (_jsx("div", { className: "space-y-2 p-4", children: Array.from({ length: 4 }).map((_, i) => (_jsx(Skeleton, { className: "h-8 w-full" }, i))) })) : schema ? (_jsxs("div", { className: "overflow-y-auto p-4", children: [_jsxs("div", { className: "mb-4 flex items-center justify-between", children: [_jsx("h2", { className: "font-mono text-sm font-semibold", children: schema.table }), _jsx("button", { onClick: () => {
                                        if (window.confirm(`"${selectedTable}" tablosunu silmek istiyor musun?`)) {
                                            dropTable({ db, table: selectedTable }).then(() => setSelectedTable(null));
                                        }
                                    }, disabled: dropping, className: "text-2xs text-red-400/60 transition-colors hover:text-red-400", children: dropping ? "Siliniyor..." : "Tabloyu sil" })] }), _jsx("div", { className: "mb-4 overflow-hidden rounded border border-border", children: _jsxs("table", { className: "w-full text-xs", children: [_jsx("thead", { children: _jsx("tr", { className: "border-b border-border bg-card", children: ["Kolon", "Tip", "Nullable", "Default", ""].map((h) => (_jsx("th", { className: "px-3 py-2 text-left font-medium text-muted-foreground/60", children: h }, h))) }) }), _jsx("tbody", { children: schema.columns.map((col) => (_jsxs("tr", { className: "border-b border-border/40 last:border-0 hover:bg-accent/10", children: [_jsx("td", { className: "px-3 py-2 font-mono", children: col.name }), _jsx("td", { className: "px-3 py-2 font-mono text-muted-foreground", children: col.type }), _jsx("td", { className: "px-3 py-2 text-muted-foreground/60", children: col.nullable }), _jsx("td", { className: "px-3 py-2 font-mono text-muted-foreground/60", children: col.default ?? "—" }), _jsx("td", { className: "px-3 py-2", children: col.primary_key && (_jsx(Badge, { variant: "outline", className: "h-4 border-amber-500/30 px-1 text-2xs text-amber-400", children: "PK" })) })] }, col.name))) })] }) }), _jsxs("div", { className: "rounded border border-border bg-zinc-950", children: [_jsxs("div", { className: "flex items-center justify-between border-b border-border/50 px-3 py-1.5", children: [_jsx("span", { className: "text-2xs font-medium text-muted-foreground/60", children: "CREATE TABLE" }), _jsxs("button", { onClick: copyDdl, className: "flex items-center gap-1 text-2xs text-muted-foreground/50 transition-colors hover:text-foreground", children: [copied ? (_jsx(Check, { className: "h-3 w-3 text-green-400" })) : (_jsx(Copy, { className: "h-3 w-3" })), copied ? "Kopyalandi" : "Kopyala"] })] }), _jsx("pre", { className: "overflow-x-auto p-3 font-mono text-xs text-foreground/80", children: ddl })] })] })) : null })] }));
}
// ── Data Tab ──────────────────────────────────────────────────────────────────
const AUTH_SCHEMA = "_postgrify_auth";
const AUTH_TABLES = ["users", "sessions"];
function DataTab({ db, activeTable, setTable, }) {
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
    const isAuthTable = activeTable.startsWith(AUTH_SCHEMA + ".") ||
        AUTH_TABLES.includes(activeTable.replace(AUTH_SCHEMA + ".", ""));
    const resolvedSchema = activeTable.startsWith(AUTH_SCHEMA + ".") ? AUTH_SCHEMA : "public";
    const resolvedTable = activeTable.startsWith(AUTH_SCHEMA + ".")
        ? activeTable.slice(AUTH_SCHEMA.length + 1)
        : activeTable;
    // Public table rows
    const { data: rowsResult, isLoading: rowsLoading, refetch } = useRows(db, isAuthTable ? "" : resolvedTable, // auth tablosu seçiliyse public hook devre dışı
    { limit: pageSize, offset: page * pageSize });
    // Auth users (sadece _postgrify_auth.users için)
    const { data: authUsersResult, isLoading: authUsersLoading, refetch: refetchAuthUsers, } = useDbAuthUsers(isAuthTable && resolvedTable === "users" ? db : "");
    // Auth rows → DataGrid formatına normalize et
    const authRows = React.useMemo(() => (authUsersResult?.users ?? []), [authUsersResult]);
    // Aktif veri + loading + refetch
    const activeRows = isAuthTable ? authRows : (rowsResult?.rows ?? []);
    const activeTotal = isAuthTable ? (authUsersResult?.total ?? 0) : (rowsResult?.total ?? 0);
    const activeLoading = isAuthTable ? authUsersLoading : rowsLoading;
    function activeRefetch() {
        if (isAuthTable) {
            refetchAuthUsers();
        }
        else {
            refetch();
        }
    }
    const columns = React.useMemo(() => {
        if (!activeRows.length)
            return [];
        return Object.keys(activeRows[0]).map((key) => ({
            key,
            label: key,
            type: "text",
        }));
    }, [activeRows]);
    const { mutateAsync: deleteRow } = useDeleteRow();
    const { mutateAsync: updateRow } = useUpdateRow();
    function rowId(row) {
        const id = row["id"] ?? Object.values(row)[0];
        return id;
    }
    async function handleDelete(rows) {
        for (const row of rows) {
            await deleteRow({ db, table: resolvedTable, id: rowId(row) });
        }
        refetch();
    }
    async function handleCellEdit(row, col, value) {
        await updateRow({
            db,
            table: resolvedTable,
            id: rowId(row),
            data: { [col]: value },
        });
        refetch();
    }
    const publicTableNames = tables?.map((t) => t.name) ?? [];
    return (_jsxs("div", { className: "flex h-full overflow-hidden", children: [_jsxs("div", { className: "flex w-48 shrink-0 flex-col border-r border-border bg-muted/10", children: [_jsx("div", { className: "flex h-9 items-center border-b border-border px-3", children: _jsx("span", { className: "text-xs font-semibold uppercase tracking-widest text-muted-foreground", children: "Tablolar" }) }), _jsx("div", { className: "flex-1 overflow-y-auto py-1", children: tablesLoading ? (_jsx("div", { className: "flex flex-col gap-1.5 px-2 py-2", children: [1, 2, 3].map((i) => _jsx(Skeleton, { className: "h-6 w-full rounded" }, i)) })) : (_jsxs(_Fragment, { children: [publicTableNames.length > 0 && (_jsxs("div", { children: [_jsx("div", { className: "px-3 pb-0.5 pt-2", children: _jsx("span", { className: "text-[10px] font-bold uppercase tracking-widest text-muted-foreground/50", children: "public" }) }), publicTableNames.map((name) => (_jsxs("button", { onClick: () => setTable(name), className: cn("flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors", activeTable === name
                                                ? "bg-accent/10 font-medium text-foreground"
                                                : "text-muted-foreground hover:bg-muted/40 hover:text-foreground"), children: [_jsx(Table2, { className: "h-3 w-3 shrink-0 opacity-60" }), _jsx("span", { className: "truncate font-mono", children: name })] }, name)))] })), _jsxs("div", { children: [_jsx("div", { className: "px-3 pb-0.5 pt-3", children: _jsx("span", { className: "text-[10px] font-bold uppercase tracking-widest text-muted-foreground/50", children: "_postgrify_auth" }) }), AUTH_TABLES.map((name) => {
                                            const fullName = `${AUTH_SCHEMA}.${name}`;
                                            return (_jsxs("button", { onClick: () => setTable(fullName), className: cn("flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors", activeTable === fullName
                                                    ? "bg-accent/10 font-medium text-foreground"
                                                    : "text-muted-foreground hover:bg-muted/40 hover:text-foreground"), children: [_jsx(KeyRound, { className: "h-3 w-3 shrink-0 opacity-60" }), _jsx("span", { className: "truncate font-mono", children: name })] }, fullName));
                                        })] })] })) })] }), _jsxs("div", { className: "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden", children: [activeTable && (_jsxs("div", { className: "flex h-9 shrink-0 items-center gap-2 border-b border-border px-3", children: [isAuthTable
                                ? _jsx(KeyRound, { className: "h-3.5 w-3.5 shrink-0 text-muted-foreground/50" })
                                : _jsx(Table2, { className: "h-3.5 w-3.5 shrink-0 text-muted-foreground/50" }), _jsxs("span", { className: "font-mono text-xs text-muted-foreground", children: [resolvedSchema !== "public" && (_jsxs("span", { className: "text-muted-foreground/50", children: [resolvedSchema, "."] })), _jsx("span", { className: "text-foreground", children: resolvedTable })] }), isAuthTable && (_jsx("span", { className: "ml-1 rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-500", children: "auth" }))] })), _jsx("div", { className: "min-h-0 flex-1 overflow-hidden", children: !activeTable ? (_jsx("div", { className: "flex h-full items-center justify-center text-sm text-muted-foreground", children: tablesLoading ? "Tablolar yükleniyor…" : "Bir tablo seçin" })) : (_jsx(DataGrid, { columns: columns, data: activeRows, total: activeTotal, page: page, pageSize: pageSize, isLoading: activeLoading, onPageChange: setPage, onPageSizeChange: (s) => { setPageSize(s); setPage(0); }, onRefresh: activeRefetch, onDelete: isAuthTable ? undefined : handleDelete, onCellEdit: isAuthTable ? undefined : handleCellEdit, db: db, tableName: resolvedTable })) })] })] }));
}
// ── SQL Editor Tab ────────────────────────────────────────────────────────────
const SCHEMA_WIDTH_KEY = "postgrify_dbpage_schema_width";
const RESULTS_HEIGHT_KEY = "postgrify_dbpage_results_pct";
function getSaved(key, fallback) {
    const raw = localStorage.getItem(key);
    const n = raw ? parseFloat(raw) : NaN;
    return isNaN(n) ? fallback : n;
}
function SqlEditorTab({ db }) {
    const [selectedTable, setSelectedTable] = React.useState("");
    const [sql, setSql] = React.useState("");
    const [result, setResult] = React.useState(null);
    const [error, setError] = React.useState(null);
    const [duration, setDuration] = React.useState();
    const [isRunning, setIsRunning] = React.useState(false);
    const [schemaWidth, setSchemaWidth] = React.useState(() => getSaved(SCHEMA_WIDTH_KEY, 240));
    const [resultsPct, setResultsPct] = React.useState(() => getSaved(RESULTS_HEIGHT_KEY, 38));
    const containerRef = React.useRef(null);
    const { data: tables } = useTables(db);
    const { data: schema } = useTableSchema(db, selectedTable);
    const tableNames = tables?.map((t) => t.name) ?? [];
    const columnNames = React.useMemo(() => {
        if (!schema || !selectedTable)
            return {};
        return { [selectedTable]: schema.columns.map((c) => c.name) };
    }, [schema, selectedTable]);
    async function runQuery() {
        if (!sql.trim() || isRunning)
            return;
        setIsRunning(true);
        setError(null);
        setResult(null);
        const t0 = Date.now();
        try {
            const data = await api.post(`/db/${db}/query`, { sql });
            setResult(data);
            setDuration(Date.now() - t0);
            saveToHistory({ sql: sql.trim(), db, ts: Date.now() });
        }
        catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        }
        finally {
            setIsRunning(false);
        }
    }
    // Yatay drag (Editor | Schema)
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
    return (_jsxs("div", { className: "flex h-full flex-col overflow-hidden", children: [_jsxs("div", { className: "flex shrink-0 items-center gap-2 border-b border-border bg-card px-3 py-2", children: [_jsxs(Select, { value: selectedTable, onValueChange: setSelectedTable, children: [_jsxs(SelectTrigger, { className: "h-7 w-36 text-xs", children: [_jsx(Table2, { className: "mr-1 h-3 w-3 shrink-0" }), _jsx(SelectValue, { placeholder: "Tablo..." })] }), _jsxs(SelectContent, { children: [_jsx(SelectItem, { value: "", className: "text-xs text-muted-foreground", children: "(tumu)" }), tables?.map((t) => (_jsx(SelectItem, { value: t.name, className: "font-mono text-xs", children: t.name }, t.name)))] })] }), _jsx("div", { className: "h-4 w-px bg-border" }), isRunning ? (_jsxs(Button, { size: "sm", variant: "destructive", onClick: () => setIsRunning(false), className: "gap-1.5", children: [_jsx(Square, { className: "h-3 w-3" }), "Iptal"] })) : (_jsxs(Button, { size: "sm", onClick: runQuery, disabled: !sql.trim(), className: "gap-1.5", children: [_jsx(Play, { className: "h-3 w-3" }), "Calistir", _jsx("span", { className: "ml-0.5 font-mono text-2xs opacity-50", children: "Ctrl+Enter" })] })), duration !== undefined && !error && (_jsxs("span", { className: "ml-auto font-mono text-2xs text-muted-foreground/50", children: [duration, "ms"] }))] }), _jsxs("div", { ref: containerRef, className: "flex min-h-0 flex-1 flex-col overflow-hidden", children: [_jsxs("div", { className: "flex min-h-0 overflow-hidden", style: { height: `${100 - resultsPct}%` }, children: [_jsx("div", { className: "min-w-0 flex-1 overflow-hidden", children: _jsx(QueryEditor, { value: sql, onChange: setSql, onRun: runQuery, tableNames: tableNames, columnNames: columnNames }) }), _jsx("div", { onMouseDown: onMouseDownH, className: "w-1 shrink-0 cursor-col-resize bg-border transition-colors hover:bg-zinc-500" }), _jsxs("div", { className: "flex flex-col overflow-hidden border-l border-border bg-card/30", style: { width: schemaWidth }, children: [_jsx("div", { className: "flex h-7 shrink-0 items-center border-b border-border px-3", children: _jsx("span", { className: "text-2xs font-semibold uppercase tracking-wider text-muted-foreground/50", children: "Schema" }) }), _jsx("div", { className: "min-h-0 flex-1 overflow-y-auto", children: tables?.map((tbl) => (_jsx(SchemaTableItem, { db: db, name: tbl.name, isSelected: selectedTable === tbl.name, onSelect: () => setSelectedTable((prev) => (prev === tbl.name ? "" : tbl.name)), onInsertName: (s) => setSql((prev) => prev + s) }, tbl.name))) })] })] }), _jsx("div", { onMouseDown: onMouseDownV, className: "h-1 shrink-0 cursor-row-resize bg-border transition-colors hover:bg-zinc-500" }), _jsx("div", { className: "flex min-h-0 flex-col overflow-hidden border-t border-border", style: { height: `${resultsPct}%` }, children: _jsx(ResultsPanel, { rows: result?.rows ?? null, rowCount: result?.count, duration: duration, error: error, isRunning: isRunning }) })] })] }));
}
function SchemaTableItem({ db, name, isSelected, onSelect, onInsertName, }) {
    const { data: schema } = useTableSchema(db, isSelected ? name : "");
    const columns = schema?.columns ?? [];
    return (_jsxs("div", { children: [_jsxs("button", { onClick: onSelect, className: cn("flex w-full items-center gap-1.5 px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent/30", isSelected && "bg-accent/20"), children: [_jsx(ChevronRight, { className: cn("h-3 w-3 shrink-0 text-muted-foreground/40 transition-transform", isSelected && "rotate-90") }), _jsx(Table2, { className: "h-3 w-3 shrink-0 text-muted-foreground/60" }), _jsx("span", { className: "flex-1 truncate font-mono text-xs text-foreground/80 hover:text-foreground", onClick: (e) => { e.stopPropagation(); onInsertName(name); }, title: `"${name}" editore ekle`, children: name })] }), isSelected && columns.length > 0 && (_jsx("div", { className: "ml-5 border-l border-border/40 pb-1", children: columns.map((col) => (_jsxs("button", { onClick: () => onInsertName(col.name), className: "flex w-full items-center gap-2 px-2 py-0.5 text-left transition-colors hover:bg-accent/20", children: [_jsx("span", { className: "flex-1 truncate font-mono text-2xs text-foreground/70", children: col.name }), _jsx("span", { className: "shrink-0 font-mono text-2xs text-muted-foreground/40", children: col.type }), col.primary_key && (_jsx("span", { className: "shrink-0 text-2xs text-amber-500/70", children: "PK" }))] }, col.name))) }))] }));
}
// ── Options Tab ───────────────────────────────────────────────────────────────
function OptionsTab({ db, dbInfo }) {
    const { mutateAsync: deleteDatabase, isPending: deleting } = useDeleteDatabase();
    const [deleteConfirm, setDeleteConfirm] = React.useState(false);
    const [deleteInput, setDeleteInput] = React.useState("");
    const navigate = useNavigate();
    async function handleDelete() {
        if (deleteInput !== db)
            return;
        await deleteDatabase(db);
        navigate("/databases");
    }
    const stats = dbInfo
        ? [
            { label: "Boyut", value: formatBytes(dbInfo.size_bytes), accent: "" },
            { label: "Tablo sayisi", value: String(dbInfo.table_count), accent: "" },
        ]
        : [];
    return (_jsx("div", { className: "h-full overflow-y-auto p-6", children: _jsxs("div", { className: "mx-auto max-w-lg space-y-6", children: [_jsx("h2", { className: "text-sm font-semibold", children: "Veritabani Secenekleri" }), _jsxs("div", { className: "rounded border border-border bg-card p-4", children: [_jsx("p", { className: "mb-1 font-mono text-xs text-foreground", children: db }), _jsx("div", { className: "mt-3 space-y-2 text-xs text-muted-foreground", children: stats.map((row, i, arr) => (_jsxs("div", { className: cn("flex justify-between", i !== arr.length - 1 && "border-b border-border/40 pb-2"), children: [_jsx("span", { children: row.label }), _jsx("span", { className: cn("font-mono", row.accent), children: row.value })] }, row.label))) })] }), _jsxs("div", { className: "rounded border border-red-900/40 bg-card p-4", children: [_jsx("p", { className: "mb-1 text-xs font-medium text-red-400", children: "Tehlikeli B\u00F6lge" }), _jsx("p", { className: "mb-3 text-xs text-muted-foreground", children: "Bu i\u015Flem geri al\u0131namaz. Veritaban\u0131 ve t\u00FCm verileri kal\u0131c\u0131 olarak silinir." }), !deleteConfirm ? (_jsx(Button, { size: "sm", variant: "destructive", onClick: () => setDeleteConfirm(true), className: "gap-1.5", children: "Veritaban\u0131n\u0131 Sil" })) : (_jsxs("div", { className: "space-y-2", children: [_jsxs("p", { className: "text-xs text-muted-foreground", children: ["Onaylamak i\u00E7in veritaban\u0131 ad\u0131n\u0131 yaz\u0131n:", " ", _jsx("span", { className: "font-mono text-foreground", children: db })] }), _jsx("input", { type: "text", value: deleteInput, onChange: (e) => setDeleteInput(e.target.value), placeholder: db, className: "h-8 w-full rounded border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-red-500" }), _jsxs("div", { className: "flex gap-2", children: [_jsxs(Button, { size: "sm", variant: "destructive", onClick: handleDelete, disabled: deleteInput !== db || deleting, className: "gap-1.5", children: [deleting ? _jsx(Loader2, { className: "h-3.5 w-3.5 animate-spin" }) : null, "Kal\u0131c\u0131 Olarak Sil"] }), _jsx(Button, { size: "sm", variant: "outline", onClick: () => { setDeleteConfirm(false); setDeleteInput(""); }, children: "\u0130ptal" })] })] }))] })] }) }));
}
