"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { WorkspaceButton } from "./workspace-button";

/**
 * Confirms a sharing change that cannot be undone from this dialog (removing
 * someone, transferring ownership). It stays open with the server's message
 * when the request fails, and closes only after the server accepts it.
 */
export function WorkspaceShareConfirm({
  open,
  title,
  description,
  confirmLabel,
  pendingLabel,
  onConfirm,
  onClose,
  onCloseAutoFocus,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  pendingLabel: string;
  /** Resolves to an error message, or null when the change succeeded. */
  onConfirm: () => Promise<string | null>;
  onClose: () => void;
  onCloseAutoFocus?: ((event: Event) => void) | undefined;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  // Keep the last text while the dialog animates closed and its target clears.
  const [shown, setShown] = useState(description);
  if (description && description !== shown) setShown(description);

  async function confirm() {
    if (pending) return;
    setPending(true);
    setError("");
    const message = await onConfirm();
    setPending(false);
    if (message) setError(message);
    else onClose();
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (next || pending) return;
        setError("");
        onClose();
      }}
    >
      <AlertDialogContent
        className="gen2-workspace-surface gen2-share-confirm"
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{shown}</AlertDialogDescription>
        </AlertDialogHeader>
        {error ? (
          <p className="gen2-share-notice" data-type="error" role="alert">
            {error}
          </p>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel asChild>
            <WorkspaceButton type="button" tone="secondary" disabled={pending}>
              Cancel
            </WorkspaceButton>
          </AlertDialogCancel>
          <WorkspaceButton
            type="button"
            tone="destructive"
            disabled={pending}
            onClick={() => void confirm()}
          >
            {pending ? (
              <Loader2 className="animate-spin" aria-hidden="true" />
            ) : null}
            {pending ? pendingLabel : confirmLabel}
          </WorkspaceButton>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
