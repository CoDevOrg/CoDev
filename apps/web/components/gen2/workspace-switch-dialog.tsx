"use client";

import { LoaderCircle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { WorkspaceButton } from "./workspace-button";

export function WorkspaceSwitchDialog({
  open,
  onOpenChange,
  activeWorkspace,
  targetWorkspaceName,
  switching,
  switchStatus,
  onConfirmSwitch,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activeWorkspace: { id: string; name: string };
  targetWorkspaceName: string;
  switching: boolean;
  switchStatus: string | null;
  onConfirmSwitch: () => void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!switching) {
          onOpenChange(nextOpen);
        }
      }}
    >
      <DialogContent className="gen2-workspace-surface sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Switch active workspace</DialogTitle>
          <DialogDescription>
            The free plan supports one active workspace at a time.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2 text-sm text-foreground">
          <p>
            <strong>“{activeWorkspace.name}”</strong> is currently running.
          </p>
          <p className="text-muted-foreground">
            Switching will stop <strong>“{activeWorkspace.name}”</strong> and
            start <strong>“{targetWorkspaceName}”</strong>. All files, Git
            commits, and configurations on both workspaces remain safely saved
            on persistent disks.
          </p>
          {switching ? (
            <div
              className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground"
              role="status"
            >
              <LoaderCircle
                className="size-3.5 animate-spin motion-reduce:animate-none"
                aria-hidden="true"
              />
              <span>{switchStatus ?? "Switching workspaces…"}</span>
            </div>
          ) : null}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <WorkspaceButton
            tone="secondary"
            type="button"
            disabled={switching}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </WorkspaceButton>
          <WorkspaceButton
            tone="primary"
            type="button"
            disabled={switching}
            onClick={onConfirmSwitch}
          >
            {switching ? "Switching…" : "Switch to this workspace"}
          </WorkspaceButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
