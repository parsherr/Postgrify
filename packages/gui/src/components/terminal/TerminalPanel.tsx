/**
 * TerminalPanel — bottom panel, VSCode tarzı sağ sidebar tab listesi.
 *
 * Layout:
 *   ┌─────────────────────────────┬──────────┐
 *   │   terminal içeriği          │ tab list │
 *   │   (aktif tab)               │          │
 *   │                             │  [new]   │
 *   └─────────────────────────────┴──────────┘
 *
 * Sağ sidebar: ~88px sabit genişlik, dikey tab listesi + "new" butonu altta.
 * Her tab: ikon + kısa isim + × (hover). Aktif tab highlight.
 * "new" → Shell / SQL dropdown.
 */

import React from "react";
import type { PanelSize } from "react-resizable-panels";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { ShellTerminal } from "./ShellTerminal";
import { SqlTerminal } from "./SqlTerminal";
import { useTerminalStore } from "./terminalStore";
import type { TerminalType } from "./terminalStore";

const PANEL_STORAGE_KEY = "postgrify_terminal_size";
const DEFAULT_OPEN_PX = 220;

/** Tab label — uzun isimleri kısalt */
function shortLabel(title: string): string {
  return title.length > 10 ? title.slice(0, 9) + "…" : title;
}

/** Shell ikonu */
function ShellIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-3.5 w-3.5 shrink-0">
      <polyline points="2,5 6,8 2,11" />
      <line x1="7" y1="11" x2="14" y2="11" />
    </svg>
  );
}

/** SQL ikonu */
function SqlIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-3.5 w-3.5 shrink-0">
      <ellipse cx="8" cy="8" rx="6" ry="3.5" />
      <line x1="2" y1="8" x2="14" y2="8" />
      <path d="M3.5 4.5 Q8 2 12.5 4.5" />
      <path d="M3.5 11.5 Q8 14 12.5 11.5" />
    </svg>
  );
}

/** + ikonu */
function PlusIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
      <path d="M8 2a.75.75 0 01.75.75v4.5h4.5a.75.75 0 010 1.5h-4.5v4.5a.75.75 0 01-1.5 0v-4.5h-4.5a.75.75 0 010-1.5h4.5v-4.5A.75.75 0 018 2z" />
    </svg>
  );
}

export function TerminalPanel() {
  const { state, addTab, removeTab, setActive, setOpen, setDb } = useTerminalStore();
  const [showTypeMenu, setShowTypeMenu] = React.useState(false);
  const menuRef = React.useRef<HTMLDivElement>(null);
  const [panelPx, setPanelPx] = React.useState<number>(32);

  const getSavedPx = (): number => {
    const raw = localStorage.getItem(PANEL_STORAGE_KEY);
    const n = raw ? parseInt(raw, 10) : NaN;
    return isNaN(n) ? DEFAULT_OPEN_PX : n;
  };

  function handlePanelResize(size: PanelSize) {
    const px = size.inPixels;
    setPanelPx(px);
    if (px > 48) {
      localStorage.setItem(PANEL_STORAGE_KEY, String(px));
      if (!state.open) setOpen(true);
    } else {
      if (state.open) setOpen(false);
    }
  }

  React.useEffect(() => {
    if (!showTypeMenu) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowTypeMenu(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showTypeMenu]);

  function handleAddTab(type: TerminalType) {
    setShowTypeMenu(false);
    addTab(type);
  }

  const isOpen = state.open && panelPx > 48;

  // ── Sağ sidebar — tab listesi ──────────────────────────────────────────────
  const sidebar = (
    <div className="flex h-full w-full flex-col border-l border-border bg-[#111113] overflow-hidden">
      {/* Tab listesi */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden py-1">
        {state.tabs.map((tab) => {
          const isActive = tab.id === state.activeId;
          return (
            <div
              key={tab.id}
              onClick={() => setActive(tab.id)}
              className={[
                "group relative flex items-center gap-1.5 px-2 py-[5px] cursor-pointer select-none transition-colors",
                isActive
                  ? "bg-[#1e1e20] text-foreground"
                  : "text-muted-foreground hover:bg-[#1a1a1c] hover:text-foreground",
              ].join(" ")}
            >
              {/* Sol aktif çizgi */}
              {isActive && (
                <span className="absolute left-0 top-1 bottom-1 w-[2px] rounded-r bg-foreground" />
              )}

              {tab.type === "shell" ? <ShellIcon /> : <SqlIcon />}

              <span className="flex-1 truncate text-[11px] leading-none font-mono">
                {shortLabel(tab.title)}
              </span>

              {/* × butonu — hover'da görünür */}
              <button
                onClick={(e) => { e.stopPropagation(); removeTab(tab.id); }}
                className="absolute right-1 opacity-0 group-hover:opacity-100 flex h-4 w-4 items-center justify-center rounded hover:bg-muted/80 transition-opacity"
              >
                <svg viewBox="0 0 16 16" fill="currentColor" className="h-2.5 w-2.5">
                  <path d="M3.72 3.72a.75.75 0 011.06 0L8 6.94l3.22-3.22a.75.75 0 111.06 1.06L9.06 8l3.22 3.22a.75.75 0 11-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 01-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 010-1.06z" />
                </svg>
              </button>
            </div>
          );
        })}
      </div>

      {/* "new" butonu — altta sabit */}
      <div className="shrink-0 p-1.5 relative" ref={menuRef}>
        <button
          onClick={() => setShowTypeMenu((v) => !v)}
          className="flex w-full items-center justify-center gap-1 rounded bg-[#e4e4e7] text-[#09090b] py-1.5 text-[11px] font-semibold hover:bg-[#d4d4d8] transition-colors"
        >
          <PlusIcon />
          new
        </button>

        {showTypeMenu && (
          <div className="absolute bottom-full left-1 right-1 mb-1 rounded-md border border-border bg-card shadow-lg z-50 overflow-hidden">
            <button
              onClick={() => handleAddTab("shell")}
              className="flex w-full items-center gap-2 px-2.5 py-2 text-xs text-foreground hover:bg-muted transition-colors"
            >
              <ShellIcon />
              <div className="text-left">
                <div className="font-medium">Shell</div>
              </div>
            </button>
            <div className="border-t border-border" />
            <button
              onClick={() => handleAddTab("sql")}
              className="flex w-full items-center gap-2 px-2.5 py-2 text-xs text-foreground hover:bg-muted transition-colors"
            >
              <SqlIcon />
              <div className="text-left">
                <div className="font-medium">SQL</div>
              </div>
            </button>
          </div>
        )}
      </div>
    </div>
  );

  // ── Header — sadece kapalıyken gösterilen ince bar ─────────────────────────
  // Kapalı hâl: 32px'lik ince bar (tab isimleri yatay, + butonu)
  const closedBar = (
    <div className="flex h-8 items-center border-b border-border bg-card px-2 gap-1 select-none">
      {/* Sekme isimleri yatay (küçük) */}
      <div className="flex items-center gap-1 flex-1 overflow-hidden min-w-0">
        {state.tabs.map((tab) => (
          <div
            key={tab.id}
            onClick={() => { setActive(tab.id); setOpen(true); }}
            className={[
              "flex items-center gap-1 rounded px-2 py-0.5 text-[11px] cursor-pointer whitespace-nowrap transition-colors",
              tab.id === state.activeId
                ? "bg-background text-foreground"
                : "text-muted-foreground hover:text-foreground",
            ].join(" ")}
          >
            {tab.type === "shell" ? <ShellIcon /> : <SqlIcon />}
            <span className="font-mono">{shortLabel(tab.title)}</span>
          </div>
        ))}
      </div>

      {/* + yeni terminal */}
      <div className="relative shrink-0" ref={menuRef}>
        <button
          onClick={() => setShowTypeMenu((v) => !v)}
          className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          title="Yeni terminal"
        >
          <PlusIcon />
        </button>

        {showTypeMenu && (
          <div className="absolute right-0 bottom-full z-50 mb-1 w-40 rounded-md border border-border bg-card shadow-lg overflow-hidden">
            <button
              onClick={() => handleAddTab("shell")}
              className="flex w-full items-center gap-2 px-3 py-2 text-xs text-foreground hover:bg-muted"
            >
              <ShellIcon />
              <span>Shell Terminal</span>
            </button>
            <div className="border-t border-border" />
            <button
              onClick={() => handleAddTab("sql")}
              className="flex w-full items-center gap-2 px-3 py-2 text-xs text-foreground hover:bg-muted"
            >
              <SqlIcon />
              <span>SQL Terminal</span>
            </button>
          </div>
        )}
      </div>

      {/* Expand butonu */}
      {state.tabs.length > 0 && (
        <button
          onClick={() => setOpen(true)}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          title="Aç"
        >
          <svg viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5 rotate-180">
            <path d="M8 10.5L3 5.5h10l-5 5z" />
          </svg>
        </button>
      )}
    </div>
  );

  return (
    <>
      <ResizableHandle />
      <ResizablePanel
        id="terminal-bottom"
        defaultSize={`${getSavedPx()}px`}
        minSize="32px"
        maxSize="70%"
        collapsible
        collapsedSize="32px"
        onResize={handlePanelResize}
        className="flex flex-col border-t border-border bg-card overflow-hidden"
      >
        {isOpen ? (
          /* Açık hâl: terminal (sol) + drag handle + sağ sidebar */
          <ResizablePanelGroup orientation="horizontal" className="h-full w-full">
            {/* Terminal içeriği */}
            <ResizablePanel id="terminal-content" defaultSize="100%" minSize="40%">
              <div className="h-full w-full overflow-hidden">
                {state.tabs.length === 0 ? (
                  <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                    Yeni terminal açmak için "new" butonuna tıklayın
                  </div>
                ) : (
                  state.tabs.map((tab) => (
                    <div
                      key={tab.id}
                      className={[
                        "h-full w-full",
                        tab.id === state.activeId ? "block" : "hidden",
                      ].join(" ")}
                    >
                      {tab.type === "shell" ? (
                        <ShellTerminal active={tab.id === state.activeId} />
                      ) : (
                        <SqlTerminal
                          selectedDb={tab.selectedDb}
                          onDbChange={(db) => setDb(tab.id, db)}
                        />
                      )}
                    </div>
                  ))
                )}
              </div>
            </ResizablePanel>

            {/* Dikey drag handle */}
            <ResizableHandle />

            {/* Sağ sidebar — resizable */}
            <ResizablePanel id="terminal-sidebar" defaultSize="88px" minSize="60px" maxSize="220px">
              {sidebar}
            </ResizablePanel>
          </ResizablePanelGroup>
        ) : (
          /* Kapalı hâl: ince bar */
          closedBar
        )}
      </ResizablePanel>
    </>
  );
}