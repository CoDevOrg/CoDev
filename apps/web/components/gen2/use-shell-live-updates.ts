"use client";

import { useRouter } from "next/navigation";

import type { Gen2WorkspaceRole } from "@codev/contracts";

import { useFilesChanged } from "./use-files-changed";
import { useRealtimeEvent } from "./use-workspace-realtime";

/**
 * Refreshes the shell's own views when other members or agents change the
 * workspace: changed files, branch counts, worktrees, agent runs, and this
 * member's role (which reloads the page so permissions match).
 */
export function useShellLiveUpdates(input: {
  currentUserId: string | undefined;
  role: Gen2WorkspaceRole;
  refreshChanges: () => void;
  refreshCounts: () => void;
  refreshWorktrees: () => void;
  refreshRuns: () => void;
}) {
  const router = useRouter();
  useFilesChanged(null, 1_000, () => input.refreshChanges());
  useFilesChanged(null, 3_000, () => input.refreshCounts());
  useRealtimeEvent("worktrees.changed", () => input.refreshWorktrees());
  useRealtimeEvent("turn.started", () => input.refreshRuns());
  useRealtimeEvent("turn.settled", () => input.refreshRuns());
  useRealtimeEvent("members.changed", (event) => {
    const mine = event.members.find(
      (member) => member.userId === input.currentUserId,
    );
    if (mine && mine.role !== input.role) router.refresh();
  });
}
