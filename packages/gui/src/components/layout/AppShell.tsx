/**
 * AppShell — resizable sidebar + main content wrapper + bottom panel.
 * Tüm protected sayfalarda kullanılır.
 * Sidebar boyutu localStorage'a kaydedilir.
 * BottomPanel: tam genişlikte, yukarı sürükleyerek açılır.
 */

import React from "react";
import type { PanelSize } from "react-resizable-panels";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { SidebarBottomPanel } from "./SidebarBottomPanel";

interface AppShellProps {
  children: React.ReactNode;
}

const SIDEBAR_STORAGE_KEY = "postgrify_sidebar_size";
const COLLAPSED_SIZE = "48px";
const MIN_SIZE = "160px";
const MAX_SIZE = "320px";

export function AppShell({ children }: AppShellProps) {
  const [isCollapsed, setIsCollapsed] = React.useState(false);

  function handleSidebarResize(panelSize: PanelSize) {
    localStorage.setItem(SIDEBAR_STORAGE_KEY, String(panelSize.inPixels));
    setIsCollapsed(panelSize.inPixels < 80);
  }

  const savedPx = React.useMemo(() => {
    const raw = localStorage.getItem(SIDEBAR_STORAGE_KEY);
    const parsed = raw ? parseInt(raw, 10) : NaN;
    return isNaN(parsed) ? 220 : parsed;
  }, []);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      <TopBar />

      {/* Orta alan: Sidebar + Main — yüksekliğin geri kalanını kaplar */}
      <div className="min-h-0 flex-1">
        <ResizablePanelGroup orientation="vertical" className="h-full">

          {/* Üst: Sidebar + İçerik */}
          <ResizablePanel id="body" defaultSize="100%" className="min-h-0 overflow-hidden">
            <ResizablePanelGroup orientation="horizontal" className="h-full">

              {/* Sidebar */}
              <ResizablePanel
                id="sidebar"
                defaultSize={`${savedPx}px`}
                minSize={MIN_SIZE}
                maxSize={MAX_SIZE}
                collapsible
                collapsedSize={COLLAPSED_SIZE}
                onResize={handleSidebarResize}
                className="flex flex-col border-r border-border bg-card transition-all duration-200"
              >
                <Sidebar collapsed={isCollapsed} />
              </ResizablePanel>

              <ResizableHandle />

              {/* Ana içerik */}
              <ResizablePanel id="main" defaultSize="100%" className="overflow-hidden">
                <div className="h-full overflow-hidden">
                  {children}
                </div>
              </ResizablePanel>

            </ResizablePanelGroup>
          </ResizablePanel>

          {/* Alt panel (Quick SQL) — tam genişlikte, drag ile açılır */}
          <SidebarBottomPanel />

        </ResizablePanelGroup>
      </div>
    </div>
  );
}