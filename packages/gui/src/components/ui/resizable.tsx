/**
 * Resizable panel components — react-resizable-panels wrapper.
 * This library exports Group / Panel / Separator (not PanelGroup/PanelResizeHandle).
 */

import { GripVertical } from "lucide-react";
import { Group, Panel, Separator } from "react-resizable-panels";
import type { GroupProps, PanelProps, SeparatorProps } from "react-resizable-panels";
import { cn } from "@/lib/utils";

const ResizablePanelGroup = ({
  className,
  orientation = "horizontal",
  ...props
}: GroupProps) => (
  <Group
    orientation={orientation}
    className={cn(
      "flex h-full w-full",
      orientation === "vertical" && "flex-col",
      className
    )}
    {...props}
  />
);

const ResizablePanel = Panel;

const ResizableHandle = ({
  withHandle,
  className,
  ...props
}: SeparatorProps & { withHandle?: boolean; className?: string }) => (
  <Separator
    className={cn(
      "relative flex shrink-0 items-center justify-center bg-border transition-colors",
      "data-[orientation=horizontal]:w-px",
      "data-[orientation=vertical]:h-px data-[orientation=vertical]:w-full",
      "hover:bg-zinc-600 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
      className
    )}
    {...props}
  >
    {withHandle && (
      <div className="z-10 flex h-4 w-3 items-center justify-center rounded-sm border bg-border">
        <GripVertical className="h-2.5 w-2.5" />
      </div>
    )}
  </Separator>
);

export { ResizablePanelGroup, ResizablePanel, ResizableHandle };
export type { GroupProps, PanelProps, SeparatorProps };