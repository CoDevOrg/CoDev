"use client";

import { useRef, type ReactNode } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/platform/utils";

/**
 * Confirmation for destructive settings actions, built on the shared
 * AlertDialog. It is rendered only while a confirmation is pending, so it is
 * always open: Radix focuses Cancel first (an accidental Enter is safe), and
 * Escape or a click outside both cancel.
 */
export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  busy = false,
  onConfirm,
  onCancel,
  className,
}: {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  /** A surface class for content portaled outside its caller's theme. */
  className?: string | undefined;
}) {
  const confirmed = useRef(false);

  return (
    <AlertDialog
      onOpenChange={(open) => {
        // The action button closes the dialog too; that is not a cancel.
        if (!open && !confirmed.current) onCancel();
      }}
      open
    >
      <AlertDialogContent className={cn("max-w-sm", className)}>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="text-sm">{children}</div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-white hover:bg-destructive/90"
            disabled={busy}
            onClick={() => {
              confirmed.current = true;
              onConfirm();
            }}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
