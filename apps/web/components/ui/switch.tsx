"use client";

import type { ComponentProps } from "react";

import { cn } from "@/lib/platform/utils";

export function Switch({
  checked,
  className,
  disabled,
  onCheckedChange,
  ...props
}: Omit<ComponentProps<"button">, "onChange" | "role"> & {
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
}) {
  return (
    <button
      aria-checked={checked}
      className={cn(
        "relative h-5 w-9 shrink-0 rounded-full outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50",
        checked ? "bg-primary" : "bg-input",
        disabled && "cursor-not-allowed opacity-50",
        className,
      )}
      data-slot="switch"
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      role="switch"
      type="button"
      {...props}
    >
      <span
        className={cn(
          "absolute top-0.5 size-4 rounded-full bg-background shadow-sm transition-transform",
          checked ? "left-4" : "left-0.5",
        )}
      />
    </button>
  );
}
