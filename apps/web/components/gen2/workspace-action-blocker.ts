import {
  GEN2_NAVIGATION_ACTIONS,
  type Gen2WorkspaceAction,
} from "@codev/contracts";

import type { WorkspaceActionView } from "./workspace-action-run";

const NAVIGATION: readonly string[] = GEN2_NAVIGATION_ACTIONS;

export function isWorkspaceNavigation(action: Gen2WorkspaceAction) {
  return NAVIGATION.includes(action.type);
}

function branchOf(view: WorkspaceActionView, worktreeId: string) {
  return (
    view.worktrees.find((worktree) => worktree.worktreeId === worktreeId)
      ?.branch ?? worktreeId
  );
}

/**
 * Why an agent's action must wait for a click right now, or null when it may
 * run on its own. Only navigation ever runs unasked, and only when it cannot
 * cost the member anything: no worktree switch (that closes their terminal),
 * no prompt about unsaved edits, and a layout that can show the result.
 */
export function workspaceActionBlocker(
  action: Gen2WorkspaceAction,
  view: WorkspaceActionView,
): string | null {
  if (!isWorkspaceNavigation(action)) return "Waits for you to confirm";
  const target = "worktreeId" in action ? action.worktreeId : undefined;
  if (target && target !== view.worktreeId) {
    return `Opens ${branchOf(view, target)}; your terminal on ${branchOf(view, view.worktreeId)} closes`;
  }
  if (action.type === "open_file" && view.dirty) {
    const name = view.openFilePath?.split("/").at(-1) ?? "the editor";
    return `You have unsaved changes in ${name}`;
  }
  if (view.viewMode !== "ide") return "Shown when you return to the IDE view";
  if (view.narrow) return "The window is too narrow to show it beside the chat";
  if (action.type === "open_preview") {
    if (!view.previewEnabled) {
      return "Browser preview isn’t available in this workspace";
    }
    if (!view.listeningPorts?.includes(action.port)) {
      return `Nothing is listening on :${action.port} yet`;
    }
  }
  if (action.type === "rename_chat" && !view.canEdit) {
    return "Only editors can rename chats";
  }
  return null;
}
