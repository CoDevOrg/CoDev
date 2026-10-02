"use client";

import * as React from "react";
import { GripVertical } from "lucide-react";
import * as ResizablePrimitive from "react-resizable-panels";

import { cn } from "@/lib/platform/utils";

export type ResizablePanelGroupProps = Omit<
  React.ComponentProps<typeof ResizablePrimitive.Group>,
  "orientation"
> & {
  direction?: "horizontal" | "vertical";
  orientation?: "horizontal" | "vertical";
};

export function ResizablePanelGroup({
  className,
  direction = "horizontal",
  orientation,
  ...props
}: ResizablePanelGroupProps) {
  const resolvedOrientation = orientation ?? direction;
  return (
    <ResizablePrimitive.Group
      data-slot="resizable-panel-group"
      orientation={resolvedOrientation}
      className={cn(
        "flex h-full w-full data-[orientation=vertical]:flex-col",
        className,
      )}
      {...props}
    />
  );
}

function normalizeSize(s?: number | string) {
  if (typeof s === "number") {
    return `${s}%`;
  }
  return s;
}

export function ResizablePanel({
  defaultSize,
  minSize,
  maxSize,
  collapsedSize,
  ...props
}: React.ComponentProps<typeof ResizablePrimitive.Panel>) {
  return (
    <ResizablePrimitive.Panel
      defaultSize={normalizeSize(defaultSize)}
      minSize={normalizeSize(minSize)}
      maxSize={normalizeSize(maxSize)}
      collapsedSize={normalizeSize(collapsedSize)}
      {...props}
    />
  );
}

export function ResizableHandle({
  withHandle,
  className,
  ...props
}: React.ComponentProps<typeof ResizablePrimitive.Separator> & {
  withHandle?: boolean;
}) {
  return (
    <ResizablePrimitive.Separator
      data-slot="resizable-handle"
      className={cn(
        "relative flex w-px items-center justify-center bg-border focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1 data-[orientation=vertical]:h-px data-[orientation=vertical]:w-full transition-colors hover:bg-ring/60",
        className,
      )}
      {...props}
    >
      {withHandle && (
        <div className="z-10 flex h-4 w-3 items-center justify-center rounded-xs border border-border bg-card">
          <GripVertical className="size-2.5 text-muted-foreground" />
        </div>
      )}
    </ResizablePrimitive.Separator>
  );
}
