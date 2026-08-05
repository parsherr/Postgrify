import { jsx as _jsx } from "react/jsx-runtime";
/**
 * Resizable panel bileşenleri — react-resizable-panels wrapper.
 * Bu kütüphane Group / Panel / Separator export eder (PanelGroup/PanelResizeHandle değil).
 */
import { GripVertical } from "lucide-react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { cn } from "@/lib/utils";
const ResizablePanelGroup = ({ className, orientation = "horizontal", ...props }) => (_jsx(Group, { orientation: orientation, className: cn("flex h-full w-full", orientation === "vertical" && "flex-col", className), ...props }));
const ResizablePanel = Panel;
const ResizableHandle = ({ withHandle, className, ...props }) => (_jsx(Separator, { className: cn("relative flex shrink-0 items-center justify-center bg-border transition-colors", "data-[orientation=horizontal]:w-px", "data-[orientation=vertical]:h-px data-[orientation=vertical]:w-full", "hover:bg-zinc-600 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring", className), ...props, children: withHandle && (_jsx("div", { className: "z-10 flex h-4 w-3 items-center justify-center rounded-sm border bg-border", children: _jsx(GripVertical, { className: "h-2.5 w-2.5" }) })) }));
export { ResizablePanelGroup, ResizablePanel, ResizableHandle };
