"use client";

import * as React from "react";
import { Check } from "lucide-react";

import { cn } from "@/lib/platform/utils";

type HoldInput = "keyboard" | "pointer";

const HOLD_KEYS = new Set(["Enter", " "]);
/** How far outside the button a held pointer may drift before the hold cancels. */
const SLACK_PX = 8;
const ROLLBACK_MS = 180;

function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true
  );
}

/**
 * A destructive action that must be pressed and held. The fill grows while
 * held and rolls back if released early; completing the hold calls
 * `onConfirm`. Works with a pointer or with Enter / Space.
 */
export function HoldToConfirmButton({
  children,
  confirmedContent,
  duration = 1_600,
  disabled,
  onConfirm,
  className,
  style,
  ...props
}: Omit<React.ComponentProps<"button">, "children" | "onClick"> & {
  children: React.ReactNode;
  /** Shown once the hold completes. */
  confirmedContent?: React.ReactNode;
  duration?: number;
  onConfirm: (input: HoldInput) => void;
}) {
  const [held, setHeld] = React.useState(false);
  const [confirmed, setConfirmed] = React.useState(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const reduced = prefersReducedMotion();

  const cancel = React.useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    setHeld(false);
  }, []);
  React.useEffect(() => cancel, [cancel]);
  const disabledRef = React.useRef(disabled);
  React.useEffect(() => {
    disabledRef.current = disabled;
  }, [disabled]);

  function start(input: HoldInput) {
    if (disabled || confirmed || timer.current !== null) return;
    setHeld(true);
    timer.current = setTimeout(() => {
      timer.current = null;
      if (disabledRef.current) return setHeld(false);
      setConfirmed(true);
      onConfirm(input);
    }, duration);
  }

  const label = confirmed ? (confirmedContent ?? "Confirmed") : children;
  const filled = held || confirmed;
  return (
    <button
      type="button"
      disabled={disabled}
      aria-live="polite"
      // Inline: the app's unlayered `button { color/font: inherit }` reset beats
      // layered utilities, as it does for the base Button.
      style={{
        color: "var(--color-destructive)",
        fontSize: "0.875rem",
        fontWeight: 500,
        ...style,
      }}
      className={cn(
        "relative inline-flex h-9 touch-none select-none items-center justify-center overflow-hidden rounded-md border border-destructive/50 bg-transparent px-4 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
      onPointerDown={(event) => {
        if (event.button > 0 || event.isPrimary === false) return;
        event.currentTarget.setPointerCapture?.(event.pointerId);
        start("pointer");
      }}
      onPointerMove={(event) => {
        if (timer.current === null) return;
        const box = event.currentTarget.getBoundingClientRect();
        const outside =
          event.clientX < box.left - SLACK_PX ||
          event.clientX > box.right + SLACK_PX ||
          event.clientY < box.top - SLACK_PX ||
          event.clientY > box.bottom + SLACK_PX;
        if (outside) cancel();
      }}
      onPointerUp={cancel}
      onPointerCancel={cancel}
      onKeyDown={(event) => {
        if (!HOLD_KEYS.has(event.key)) return;
        event.preventDefault();
        if (!event.repeat) start("keyboard");
      }}
      onKeyUp={(event) => {
        if (HOLD_KEYS.has(event.key)) cancel();
      }}
      onBlur={cancel}
      onClick={(event) => event.preventDefault()}
      {...props}
    >
      <span className="relative inline-flex items-center gap-2">{label}</span>
      <span
        aria-hidden="true"
        data-slot="hold-fill"
        className="absolute inset-0 inline-flex items-center justify-center gap-2 bg-destructive text-white"
        style={{
          clipPath: filled ? "inset(0 0 0 0)" : "inset(0 100% 0 0)",
          transition: reduced
            ? "none"
            : held
              ? `clip-path ${duration}ms linear`
              : `clip-path ${ROLLBACK_MS}ms ease-out`,
        }}
      >
        {confirmed && confirmedContent === undefined ? (
          <Check className="size-4" />
        ) : null}
        {label}
      </span>
    </button>
  );
}
