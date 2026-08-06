import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
/**
 * SqlTerminal — DB seçici + CodeMirror SQL editörü + sonuç tablosu.
 * Ctrl+Enter veya "Çalıştır" butonu ile POST /db/:db/query çağrısı yapar.
 * @codemirror/* paketleri zaten kurulu (QueryPage'den), @uiw/react-codemirror yok.
 */
import { useState, useCallback, useRef, useEffect } from "react";
import { EditorView, keymap, lineNumbers, highlightActiveLine } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { sql } from "@codemirror/lang-sql";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { useDatabases } from "../../hooks/useDatabases";
import { api } from "../../lib/api";
export function SqlTerminal({ selectedDb, onDbChange }) {
    const { data: databases } = useDatabases();
    const editorRef = useRef(null);
    const viewRef = useRef(null);
    const [result, setResult] = useState(null);
    const [error, setError] = useState(null);
    const [running, setRunning] = useState(false);
    const startRef = useRef(0);
    const runQuery = useCallback(async () => {
        const view = viewRef.current;
        if (!view)
            return;
        const query = view.state.doc.toString().trim();
        if (!selectedDb) {
            setError("Önce bir veritabanı seçin");
            return;
        }
        if (!query)
            return;
        setRunning(true);
        setError(null);
        setResult(null);
        startRef.current = performance.now();
        try {
            const res = await api.post(`/db/${selectedDb}/query`, { sql: query });
            const duration = performance.now() - startRef.current;
            setResult({ rows: res.rows, rowCount: res.rowCount, duration });
        }
        catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        }
        finally {
            setRunning(false);
        }
    }, [selectedDb]);
    // Ctrl+Enter keymap
    const runKeymap = useCallback(() => {
        runQuery();
        return true;
    }, [runQuery]);
    // CodeMirror init
    useEffect(() => {
        if (!editorRef.current)
            return;
        const state = EditorState.create({
            doc: "SELECT 1;",
            extensions: [
                history(),
                lineNumbers(),
                highlightActiveLine(),
                sql(),
                keymap.of([
                    {
                        key: "Ctrl-Enter",
                        mac: "Cmd-Enter",
                        run: () => { runQuery(); return true; },
                    },
                    ...defaultKeymap,
                    ...historyKeymap,
                ]),
                EditorView.theme({
                    "&": { height: "100%", backgroundColor: "#0d0d0f" },
                    ".cm-scroller": { overflow: "auto", fontFamily: "inherit" },
                    ".cm-gutters": { backgroundColor: "#0d0d0f", borderRightColor: "#27272a" },
                    ".cm-gutter": { backgroundColor: "#0d0d0f" },
                    ".cm-activeLineGutter": { backgroundColor: "#18181b" },
                    ".cm-content": { backgroundColor: "#0d0d0f" },
                    ".cm-line": { backgroundColor: "transparent" },
                    ".cm-activeLine": { backgroundColor: "#18181b" },
                }),
            ],
        });
        const view = new EditorView({ state, parent: editorRef.current });
        viewRef.current = view;
        return () => {
            view.destroy();
            viewRef.current = null;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    // runQuery değişince keymap'i güncelle (closure yenileme olmadan)
    // EditorView'ı yeniden oluşturmadan keymap'e erişmek için ref kullanıyoruz
    const runQueryRef = useRef(runQuery);
    useEffect(() => { runQueryRef.current = runQuery; }, [runQuery]);
    // runKeymap ref — closure sorununu önler
    useEffect(() => {
        void runKeymap; // lint
    }, [runKeymap]);
    const columns = result?.rows?.[0] ? Object.keys(result.rows[0]) : [];
    return (_jsxs("div", { className: "flex h-full flex-col overflow-hidden", children: [_jsxs("div", { className: "flex items-center gap-2 border-b border-border px-3 py-1.5 shrink-0 bg-background", children: [_jsxs("select", { value: selectedDb ?? "", onChange: (e) => onDbChange(e.target.value), className: "h-7 rounded border border-border bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring", children: [_jsx("option", { value: "", disabled: true, children: "Veritaban\u0131 se\u00E7\u2026" }), databases?.map((db) => (_jsx("option", { value: db.name, children: db.name }, db.name)))] }), _jsx("div", { className: "flex-1" }), _jsxs("button", { onClick: runQuery, disabled: running || !selectedDb, className: "flex h-7 items-center gap-1.5 rounded bg-foreground px-3 text-xs font-medium text-background hover:bg-foreground/90 disabled:opacity-40 transition-colors", children: [running ? (_jsx("span", { className: "h-3 w-3 rounded-full border-2 border-background/40 border-t-background animate-spin" })) : (_jsx("svg", { viewBox: "0 0 16 16", fill: "currentColor", className: "h-3 w-3", children: _jsx("path", { d: "M4 2l10 6-10 6V2z" }) })), "\u00C7al\u0131\u015Ft\u0131r", _jsx("span", { className: "ml-0.5 text-background/50", children: "\u2303\u21B5" })] })] }), _jsx("div", { className: "shrink-0 overflow-hidden border-b border-border bg-[#0d0d0f]", style: { height: "40%", fontFamily: '"GeistMono", "JetBrains Mono", Menlo, monospace', fontSize: 12 }, children: _jsx("div", { ref: editorRef, className: "h-full" }) }), _jsxs("div", { className: "flex-1 overflow-auto min-h-0 bg-background", children: [error && (_jsx("div", { className: "m-2 rounded border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive font-mono", children: error })), result && !error && (_jsxs(_Fragment, { children: [_jsxs("div", { className: "flex items-center gap-3 border-b border-border px-3 py-1.5 text-xs text-muted-foreground", children: [_jsxs("span", { children: [result.rowCount, " sat\u0131r"] }), result.duration !== undefined && (_jsxs("span", { children: [result.duration.toFixed(1), " ms"] }))] }), columns.length > 0 ? (_jsxs("table", { className: "w-full text-xs", children: [_jsx("thead", { children: _jsx("tr", { className: "border-b border-border bg-muted/30 sticky top-0", children: columns.map((col) => (_jsx("th", { className: "px-3 py-1.5 text-left font-medium text-muted-foreground whitespace-nowrap", children: col }, col))) }) }), _jsx("tbody", { children: result.rows.map((row, i) => (_jsx("tr", { className: "border-b border-border/50 hover:bg-muted/20", children: columns.map((col) => (_jsx("td", { className: "px-3 py-1.5 text-foreground/80 font-mono whitespace-nowrap max-w-[200px] overflow-hidden text-ellipsis", title: String(row[col] ?? ""), children: row[col] === null ? (_jsx("span", { className: "text-muted-foreground italic", children: "null" })) : (String(row[col])) }, col))) }, i))) })] })) : (_jsx("div", { className: "px-3 py-2 text-xs text-muted-foreground", children: "Sorgu ba\u015Far\u0131l\u0131, sonu\u00E7 yok." }))] })), !result && !error && !running && (_jsx("div", { className: "flex h-full items-center justify-center text-xs text-muted-foreground", children: "Sorgu yaz\u0131n, Ctrl+Enter ile \u00E7al\u0131\u015Ft\u0131r\u0131n" }))] })] }));
}
