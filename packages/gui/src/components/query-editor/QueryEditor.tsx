import { useRef, useCallback, useEffect } from "react";
import Editor, { OnMount } from "@monaco-editor/react";
import { Play, Loader2 } from "lucide-react";
import { sqlTheme } from "./sqlTheme";

interface QueryEditorProps {
  value: string;
  onChange: (value: string) => void;
  onExecute: () => void;
  isExecuting?: boolean;
  height?: string;
  placeholder?: string;
}

/**
 * SQL editor with Monaco, keyboard shortcut support, and execute button.
 * Ctrl/Cmd+Enter runs the query.
 */
export function QueryEditor({
  value,
  onChange,
  onExecute,
  isExecuting = false,
  height = "200px",
  placeholder,
}: QueryEditorProps) {
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);

  const handleMount: OnMount = useCallback(
    (editor, monaco) => {
      editorRef.current = editor;

      // Register custom theme
      monaco.editor.defineTheme("postgrify-dark", sqlTheme as Parameters<typeof monaco.editor.defineTheme>[1]);
      monaco.editor.setTheme("postgrify-dark");

      // Ctrl/Cmd+Enter → execute
      editor.addCommand(
        monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter,
        () => {
          onExecute();
        }
      );

      // Ctrl/Cmd+Shift+F → format
      editor.addCommand(
        monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyF,
        () => {
          editor.getAction("editor.action.formatDocument")?.run();
        }
      );
    },
    [onExecute]
  );

  // Update execute handler when it changes without remounting
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
  }, [onExecute]);

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-slate-700/50 bg-slate-800/50">
        <span className="text-xs text-slate-500 font-mono">SQL</span>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-600">Ctrl+Enter to execute</span>
          <button
            onClick={onExecute}
            disabled={isExecuting || !value.trim()}
            className="flex items-center gap-1.5 px-3 py-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-medium rounded transition-colors"
          >
            {isExecuting ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Play className="w-3.5 h-3.5" />
            )}
            {isExecuting ? "Executing..." : "Execute"}
          </button>
        </div>
      </div>

      {/* Editor */}
      <div className="flex-1 relative">
        {!value && placeholder && (
          <div className="absolute top-3 left-14 text-slate-600 text-sm pointer-events-none z-10 font-mono">
            {placeholder}
          </div>
        )}
        <Editor
          height={height}
          language="sql"
          value={value}
          onChange={(v) => onChange(v ?? "")}
          onMount={handleMount}
          options={{
            minimap: { enabled: false },
            fontSize: 13,
            lineHeight: 20,
            fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
            fontLigatures: true,
            scrollBeyondLastLine: false,
            renderLineHighlight: "line",
            cursorBlinking: "smooth",
            smoothScrolling: true,
            contextmenu: true,
            folding: false,
            lineDecorationsWidth: 4,
            lineNumbersMinChars: 3,
            overviewRulerLanes: 0,
            hideCursorInOverviewRuler: true,
            overviewRulerBorder: false,
            scrollbar: {
              vertical: "auto",
              horizontal: "auto",
              verticalScrollbarSize: 8,
              horizontalScrollbarSize: 8,
            },
            suggest: {
              showKeywords: true,
              showSnippets: true,
            },
            wordWrap: "on",
            automaticLayout: true,
          }}
          theme="postgrify-dark"
        />
      </div>
    </div>
  );
}