import * as React from "react";

import { cn } from "@/lib/utils";

const VARIANT_CLASSES = {
  default: "bg-primary text-primary-foreground hover:bg-primary/90",
  outline:
    "border border-border bg-background text-foreground hover:border-muted-foreground/35 hover:bg-accent hover:text-accent-foreground",
  secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
} as const;

// Some pages (the settings area) load Tailwind utilities inside a CSS
// `@layer`, but the app's own global reset sets `button { color: inherit }`
// as plain, unlayered CSS — which always wins over layered utility classes
// regardless of specificity, silently breaking `text-*-foreground` above.
// An inline style has the highest priority of all short of `!important`, so
// it wins unconditionally instead of depending on cascade-layer plumbing.
const VARIANT_TEXT_COLOR = {
  default: "var(--color-primary-foreground)",
  outline: "var(--color-foreground)",
  secondary: "var(--color-secondary-foreground)",
} as const;

const SIZE_CLASSES = {
  default: "h-9 px-4 py-2",
  sm: "h-8 gap-1.5 px-3 text-sm",
  "icon-sm": "size-8",
} as const;

export function buttonClassName({
  variant = "default",
  size = "default",
  className,
}: {
  variant?: keyof typeof VARIANT_CLASSES | undefined;
  size?: keyof typeof SIZE_CLASSES | undefined;
  className?: string | undefined;
} = {}) {
  return cn(
    "inline-flex shrink-0 items-center justify-center gap-2 rounded-md cursor-pointer text-sm font-medium whitespace-nowrap transition-all outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50",
    VARIANT_CLASSES[variant],
    SIZE_CLASSES[size],
    className,
  );
}

export const Button = React.forwardRef<
  HTMLButtonElement,
  React.ComponentProps<"button"> & {
    variant?: keyof typeof VARIANT_CLASSES;
    size?: keyof typeof SIZE_CLASSES;
  }
>(function Button(
  { className, variant = "default", size = "default", style, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      data-slot="button"
      style={{ color: VARIANT_TEXT_COLOR[variant], ...style }}
      className={buttonClassName({ variant, size, className })}
      {...props}
    />
  );
});

export const LinkButton = React.forwardRef<
  HTMLAnchorElement,
  React.ComponentProps<"a"> & {
    variant?: keyof typeof VARIANT_CLASSES;
    size?: keyof typeof SIZE_CLASSES;
  }
>(function LinkButton(
  { className, variant = "default", size = "default", style, ...props },
  ref,
) {
  return (
    <a
      ref={ref}
      data-slot="button"
      style={{ color: VARIANT_TEXT_COLOR[variant], ...style }}
      className={buttonClassName({ variant, size, className })}
      {...props}
    />
  );
});
