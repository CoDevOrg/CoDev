"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/platform/utils";

/** Workspace controls: appearance lives in workspace.css, callers own layout only. */
export const WorkspaceButton = React.forwardRef<
  HTMLButtonElement,
  Omit<React.ComponentProps<typeof Button>, "variant" | "size"> & {
    tone?: "primary" | "secondary" | "ghost" | "destructive";
    size?: "toolbar" | "action" | "icon";
  }
>(function WorkspaceButton(
  { tone = "ghost", size = "toolbar", className, type = "button", ...props },
  ref,
) {
  return (
    <Button
      ref={ref}
      type={type}
      variant={
        tone === "primary"
          ? "default"
          : tone === "secondary"
            ? "outline"
            : tone === "destructive"
              ? "destructive"
              : "ghost"
      }
      size={size === "icon" ? "icon-sm" : size === "action" ? "default" : "sm"}
      className={cn("gen2-workspace-button", className)}
      data-tone={tone}
      data-size={size}
      {...props}
    />
  );
});
