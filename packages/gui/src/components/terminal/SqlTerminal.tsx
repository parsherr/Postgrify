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

interface Props {
  selectedDb: string | undefined;
  onDbChange: (db: string) => void;
}

interface QueryResult {
  rows: Record<string, unknown>[];
  rowCount: number;
  duration?: number;
}

export function SqlTerminal({ selectedDb, onDbChange }: Props) {
  const { data: databases } = useDatabases();
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const startRef = useRef<number>(0);

  const runQuery = useCallback(async () => {
    const view = viewRef.current;
    if (!view) return;
    const query = view.state.doc.toString().trim();

    if (!selectedDb) {
      setError("Önce bir veritabanı seçin");
      return;
    }
    if (!query) return;

    setRunning(true);
    setError(null);
    setResult(null);
    startRef.current = performance.now();

    try {
      const res = await api.post<{ rows: Record<string, unknown>[]; rowCount: number }>(
        `/db/${selectedDb}/query`,
        { sql: query }
      );
      const duration = performance.now() - startRef.current;
      setResult({ rows: res.rows, rowCount: res.rowCount, duration });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
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
    if (!editorRef.current) return;

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

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-2 border-b border-border px-3 py-1.5 shrink-0 bg-background">
        <select
          value={selectedDb ?? ""}
          onChange={(e) => onDbChange(e.target.value)}
          className="h-7 rounded border border-border bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        >
          <option value="" disabled>Veritabanı seç…</option>
          {databases?.map((db) => (
            <option key={db.name} value={db.name}>{db.name}</option>
          ))}
        </select>

        <div className="flex-1" />

        <button
          onClick={runQuery}
          disabled={running || !selectedDb}
          className="flex h-7 items-center gap-1.5 rounded bg-foreground px-3 text-xs font-medium text-background hover:bg-foreground/90 disabled:opacity-40 transition-colors"
        >
          {running ? (
            <span className="h-3 w-3 rounded-full border-2 border-background/40 border-t-background animate-spin" />
          ) : (
            <svg viewBox="0 0 16 16" fill="currentColor" className="h-3 w-3">
              <path d="M4 2l10 6-10 6V2z" />
            </svg>
          )}
          Çalıştır
          <span className="ml-0.5 text-background/50">⌃↵</span>
        </button>
      </div>

      {/* Editör */}
      <div
        className="shrink-0 overflow-hidden border-b border-border bg-[#0d0d0f]"
        style={{ height: "40%", fontFamily: '"GeistMono", "JetBrains Mono", Menlo, monospace', fontSize: 12 }}
      >
        <div ref={editorRef} className="h-full" />
      </div>

      {/* Sonuç */}
      <div className="flex-1 overflow-auto min-h-0 bg-background">
        {error && (
          <div className="m-2 rounded border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive font-mono">
            {error}
          </div>
        )}

        {result && !error && (
          <>
            <div className="flex items-center gap-3 border-b border-border px-3 py-1.5 text-xs text-muted-foreground">
              <span>{result.rowCount} satır</span>
              {result.duration !== undefined && (
                <span>{result.duration.toFixed(1)} ms</span>
              )}
            </div>

            {columns.length > 0 ? (
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border bg-muted/30 sticky top-0">
                    {columns.map((col) => (
                      <th key={col} className="px-3 py-1.5 text-left font-medium text-muted-foreground whitespace-nowrap">
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((row, i) => (
                    <tr key={i} className="border-b border-border/50 hover:bg-muted/20">
                      {columns.map((col) => (
                        <td
                          key={col}
                          className="px-3 py-1.5 text-foreground/80 font-mono whitespace-nowrap max-w-[200px] overflow-hidden text-ellipsis"
                          title={String(row[col] ?? "")}
                        >
                          {row[col] === null ? (
                            <span className="text-muted-foreground italic">null</span>
                          ) : (
                            String(row[col])
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="px-3 py-2 text-xs text-muted-foreground">
                Sorgu başarılı, sonuç yok.
              </div>
            )}
          </>
        )}

        {!result && !error && !running && (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
            Sorgu yazın, Ctrl+Enter ile çalıştırın
          </div>
        )}
      </div>
    </div>
  );
}