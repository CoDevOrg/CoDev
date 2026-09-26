"use client";

import * as React from "react";
import * as ToggleGroupPrimitive from "@radix-ui/react-toggle-group";
import { motion } from "motion/react";

import { cn } from "@/lib/platform/utils";

const ToggleGroupContext = React.createContext<{
  layoutId: string;
  activeValue: string | undefined;
}>({ layoutId: "toggle-group", activeValue: undefined });

export function ToggleGroup({
  layoutId,
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Root> & {
  layoutId?: string;
}) {
  const id = React.useId();
  const activeValue = typeof props.value === "string" ? props.value : undefined;

  return (
    <ToggleGroupContext.Provider
      value={{ layoutId: layoutId ?? id, activeValue }}
    >
      <ToggleGroupPrimitive.Root
        data-slot="toggle-group"
        {...props}
        className={cn("flex items-center gap-1.5", props.className)}
      />
    </ToggleGroupContext.Provider>
  );
}

export function ToggleGroupItem({
  className,
  children,
  value,
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Item>) {
  const { layoutId, activeValue } = React.useContext(ToggleGroupContext);
  const isActive = activeValue === value;

  return (
    <ToggleGroupPrimitive.Item
      value={value}
      data-slot="toggle-group-item"
      // globals.css sets a plain, unlayered `button { color: inherit }`
      // reset, which — per CSS cascade layers — always beats a layered
      // Tailwind utility like `text-background` regardless of specificity
      // (the same issue button.tsx's own variant colors work around). An
      // inline style is the only thing short of `!important` that wins.
      style={isActive ? { color: "var(--color-background)" } : undefined}
      className={cn(
        "relative inline-flex h-8 items-center justify-center whitespace-nowrap rounded-full border border-border bg-transparent px-3.5 text-xs font-semibold outline-none transition-colors",
        isActive
          ? "border-transparent"
          : "text-muted-foreground hover:border-input",
        className,
      )}
      {...props}
    >
      {isActive ? (
        <motion.span
          layoutId={layoutId}
          className="absolute inset-0 rounded-full bg-foreground"
          transition={{ type: "spring", stiffness: 500, damping: 38 }}
        />
      ) : null}
      <span className="relative z-10">{children}</span>
    </ToggleGroupPrimitive.Item>
  );
}
