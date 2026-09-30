"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";

import { Button } from "@/components/ui/button";

/**
 * In-app replacement for `window.confirm` on destructive settings actions.
 * Focus starts on Cancel so an accidental Enter is safe; Escape and a click on
 * the scrim both cancel.
 */
export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  busy = false,
  onConfirm,
  onCancel,
}: {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const titleId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    cancelRef.current?.focus();
    return () => opener?.focus?.();
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") onCancel();
      }}
    >
      <div
        aria-labelledby={titleId}
        aria-modal="true"
        className="w-full max-w-sm space-y-4 rounded-xl border border-border bg-card p-5 shadow-xl"
        role="alertdialog"
      >
        <div className="space-y-1.5">
          <h2 className="text-base font-semibold" id={titleId}>
            {title}
          </h2>
          <div className="text-sm text-muted-foreground">{children}</div>
        </div>
        <div className="flex justify-end gap-2">
          <Button
            onClick={onCancel}
            ref={cancelRef}
            type="button"
            variant="secondary"
          >
            Cancel
          </Button>
          <button
            className="inline-flex h-9 cursor-pointer items-center justify-center rounded-md bg-destructive px-4 text-sm font-medium text-white transition-colors outline-none hover:bg-destructive/90 focus-visible:ring-[3px] focus-visible:ring-destructive/40 disabled:pointer-events-none disabled:opacity-50"
            disabled={busy}
            onClick={onConfirm}
            type="button"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
