import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * AppShell — resizable sidebar + main content wrapper + bottom panel.
 * Tüm protected sayfalarda kullanılır.
 * Sidebar boyutu localStorage'a kaydedilir.
 * BottomPanel: tam genişlikte, yukarı sürükleyerek açılır.
 */
import React from "react";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle, } from "@/components/ui/resizable";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { TerminalPanel } from "@/components/terminal/TerminalPanel";
const SIDEBAR_STORAGE_KEY = "postgrify_sidebar_size";
const COLLAPSED_SIZE = "48px";
const MIN_SIZE = "160px";
const MAX_SIZE = "320px";
export function AppShell({ children }) {
    const [isCollapsed, setIsCollapsed] = React.useState(false);
    function handleSidebarResize(panelSize) {
        localStorage.setItem(SIDEBAR_STORAGE_KEY, String(panelSize.inPixels));
        setIsCollapsed(panelSize.inPixels < 80);
    }
    const savedPx = React.useMemo(() => {
        const raw = localStorage.getItem(SIDEBAR_STORAGE_KEY);
        const parsed = raw ? parseInt(raw, 10) : NaN;
        return isNaN(parsed) ? 220 : parsed;
    }, []);
    return (_jsxs("div", { className: "flex h-screen flex-col overflow-hidden bg-background", children: [_jsx(TopBar, {}), _jsx("div", { className: "min-h-0 flex-1", children: _jsxs(ResizablePanelGroup, { orientation: "vertical", className: "h-full", children: [_jsx(ResizablePanel, { id: "body", defaultSize: "100%", className: "min-h-0 overflow-hidden", children: _jsxs(ResizablePanelGroup, { orientation: "horizontal", className: "h-full", children: [_jsx(ResizablePanel, { id: "sidebar", defaultSize: `${savedPx}px`, minSize: MIN_SIZE, maxSize: MAX_SIZE, collapsible: true, collapsedSize: COLLAPSED_SIZE, onResize: handleSidebarResize, className: "flex flex-col border-r border-border bg-card transition-all duration-200", children: _jsx(Sidebar, { collapsed: isCollapsed }) }), _jsx(ResizableHandle, {}), _jsx(ResizablePanel, { id: "main", defaultSize: "100%", className: "overflow-hidden", children: _jsx("div", { className: "h-full overflow-hidden", children: children }) })] }) }), _jsx(TerminalPanel, {})] }) })] }));
}
