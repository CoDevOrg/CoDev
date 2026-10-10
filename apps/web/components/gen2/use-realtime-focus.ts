"use client";

import { useEffect, useSyncExternalStore } from "react";
import type { Gen2WorkspaceView } from "@codev/contracts";

import { useWorkspaceRealtime } from "./use-workspace-realtime";
import type { WorkspaceView } from "./workspace-view-url";

function subscribeVisibility(notify: () => void) {
  document.addEventListener("visibilitychange", notify);
  return () => document.removeEventListener("visibilitychange", notify);
}

/** What other members see about this tab: worktree, area, file and chat. */
export function presenceView(
  view: WorkspaceView & { inspectorCollapsed: boolean },
): Gen2WorkspaceView {
  if (view.board) return "board";
  if (view.inspectorCollapsed) return "chat";
  return view.tab ?? "chat";
}

/**
 * Reports where this tab is whenever it moves, and marks it away while the
 * tab is hidden. Takes the same view the page URL records.
 */
export function useRealtimeFocus(
  view: WorkspaceView & { worktreeId: string; inspectorCollapsed: boolean },
) {
  const { send, generation } = useWorkspaceRealtime();
  const hidden = useSyncExternalStore(
    subscribeVisibility,
    () => document.visibilityState === "hidden",
    () => false,
  );
  const area = presenceView(view);
  const path = area === "files" ? (view.file ?? null) : null;
  const { worktreeId, chatId } = view;
  useEffect(() => {
    send({
      type: "focus",
      worktreeId,
      path,
      view: area,
      chatId: chatId ?? null,
      away: hidden,
    });
  }, [send, generation, worktreeId, path, area, chatId, hidden]);
}
