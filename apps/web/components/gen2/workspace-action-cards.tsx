"use client";

import type { PendingWorkspaceAction } from "./use-workspace-action-dispatch";

/**
 * Decision cards for an agent's proposals, shown above the composer.
 * Placeholder: the implementation lands with the workspace actions package.
 */
export function WorkspaceActionCards({
  pending,
  onResolve,
}: {
  pending: PendingWorkspaceAction[];
  onResolve(key: string, outcome: "done" | "dismissed", message?: string): void;
}) {
  void pending;
  void onResolve;
  return null;
}
