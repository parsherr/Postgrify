import { jsx as _jsx } from "react/jsx-runtime";
/**
 * QueryEditor — CodeMirror 6 wrapper.
 * PostgreSQL syntax highlighting, autocomplete, custom zinc theme.
 */
import React from "react";
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter } from "@codemirror/view";
import { EditorState, Compartment } from "@codemirror/state";
import { sql, PostgreSQL } from "@codemirror/lang-sql";
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap, } from "@codemirror/autocomplete";
import { defaultKeymap, historyKeymap, history, indentWithTab, } from "@codemirror/commands";
import { indentOnInput, bracketMatching, foldGutter, foldKeymap, } from "@codemirror/language";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { zincTheme, zincHighlight } from "./sqlTheme";
import { cn } from "@/lib/utils";
export function QueryEditor({ value, onChange, onRun, tableNames = [], columnNames = {}, className, }) {
    const containerRef = React.useRef(null);
    const editorRef = React.useRef(null);
    const onRunRef = React.useRef(onRun);
    const onChangeRef = React.useRef(onChange);
    // Ref'leri güncel tut — her render'da yeniden bind etme
    React.useEffect(() => { onRunRef.current = onRun; }, [onRun]);
    React.useEffect(() => { onChangeRef.current = onChange; }, [onChange]);
    // Schema için autocomplete kaynağı
    const schemaCompartment = React.useRef(new Compartment());
    function buildSchema() {
        const schema = {};
        tableNames.forEach((tbl) => {
            schema[tbl] = columnNames[tbl] ?? [];
        });
        return schema;
    }
    // Editor'ü ilk kez oluştur
    React.useEffect(() => {
        if (!containerRef.current || editorRef.current)
            return;
        const updateListener = EditorView.updateListener.of((update) => {
            if (update.docChanged) {
                onChangeRef.current(update.state.doc.toString());
            }
        });
        // Ctrl+Enter / Cmd+Enter → çalıştır
        const runKeymap = keymap.of([
            {
                key: "Ctrl-Enter",
                mac: "Cmd-Enter",
                run: () => {
                    onRunRef.current?.();
                    return true;
                },
            },
        ]);
        const state = EditorState.create({
            doc: value,
            extensions: [
                // Tema
                zincTheme,
                zincHighlight,
                // Dil — PostgreSQL dialect
                sql({ dialect: PostgreSQL, schema: buildSchema() }),
                schemaCompartment.current.of([]),
                // Temel özellikler
                lineNumbers(),
                highlightActiveLine(),
                highlightActiveLineGutter(),
                history(),
                foldGutter(),
                bracketMatching(),
                closeBrackets(),
                indentOnInput(),
                highlightSelectionMatches(),
                autocompletion(),
                // Keymap'ler
                keymap.of([
                    ...closeBracketsKeymap,
                    ...defaultKeymap,
                    ...historyKeymap,
                    ...completionKeymap,
                    ...foldKeymap,
                    ...searchKeymap,
                    indentWithTab,
                ]),
                runKeymap,
                updateListener,
                // Word wrap
                EditorView.lineWrapping,
            ],
        });
        const view = new EditorView({
            state,
            parent: containerRef.current,
        });
        editorRef.current = view;
        return () => {
            view.destroy();
            editorRef.current = null;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []); // sadece mount'ta çalışır
    // Dışarıdan value değişince editor'ü güncelle (controlled)
    React.useEffect(() => {
        const editor = editorRef.current;
        if (!editor)
            return;
        const current = editor.state.doc.toString();
        if (current !== value) {
            editor.dispatch({
                changes: { from: 0, to: current.length, insert: value },
            });
        }
    }, [value]);
    // Schema değişince autocomplete'i güncelle
    React.useEffect(() => {
        const editor = editorRef.current;
        if (!editor || tableNames.length === 0)
            return;
        editor.dispatch({
            effects: schemaCompartment.current.reconfigure(sql({ dialect: PostgreSQL, schema: buildSchema() })),
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tableNames, columnNames]);
    return (_jsx("div", { ref: containerRef, className: cn("h-full w-full overflow-auto", "[&_.cm-editor]:h-full", "[&_.cm-scroller]:h-full", className) }));
}
