"use client";

import { useState } from "react";

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

/** The open file with unsaved edits, and the file to show instead. */
export type DiscardTarget = { from: string; to: string };

/**
 * Asks before the Files pane drops unsaved edits to open another file, or
 * to reload the same one (`from === to`). Dismissing it keeps the edits.
 */
export function DiscardChangesDialog({
  target,
  onDiscard,
  onKeep,
}: {
  target: DiscardTarget | null;
  onDiscard: () => void;
  onKeep: () => void;
}) {
  // Keep the last text while the dialog animates closed.
  const [shown, setShown] = useState(target);
  if (target && target !== shown) setShown(target);
  const reload = shown?.from === shown?.to;

  return (
    <AlertDialog
      open={target !== null}
      onOpenChange={(open) => {
        if (!open) onKeep();
      }}
    >
      <AlertDialogContent className="gen2-workspace-surface gen2-share-confirm">
        <AlertDialogHeader>
          <AlertDialogTitle>Discard unsaved changes?</AlertDialogTitle>
          <AlertDialogDescription>
            Your edits to <strong>{shown?.from}</strong> aren’t saved.{" "}
            {reload ? (
              "Loading the latest version discards them."
            ) : (
              <>
                Opening <strong>{shown?.to}</strong> discards them.
              </>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel asChild>
            <WorkspaceButton type="button" tone="secondary">
              Keep editing
            </WorkspaceButton>
          </AlertDialogCancel>
          <WorkspaceButton type="button" tone="destructive" onClick={onDiscard}>
            {reload ? "Discard and reload" : "Discard and open"}
          </WorkspaceButton>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
