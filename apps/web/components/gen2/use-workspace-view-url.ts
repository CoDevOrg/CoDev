"use client";

import { useEffect } from "react";

import { workspaceViewUrl, type WorkspaceView } from "./workspace-view-url";

/**
 * Keeps the page URL on the member's current view, so a refresh, a new tab
 * or a shared link opens the same worktree, chat, tab and file. It replaces
 * the history entry rather than adding one per click.
 */
export function useWorkspaceViewUrl(view: WorkspaceView) {
  const { worktreeId, chatId, tab, file, board, terminal } = view;
  useEffect(() => {
    const next = workspaceViewUrl(window.location.href, {
      worktreeId,
      chatId,
      tab,
      file,
      board,
      terminal,
    });
    if (next !== window.location.href)
      window.history.replaceState(window.history.state, "", next);
  }, [worktreeId, chatId, tab, file, board, terminal]);
}
