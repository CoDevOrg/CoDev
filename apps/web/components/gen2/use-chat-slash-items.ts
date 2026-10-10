"use client";

import { buildSlashItems, type SlashContext } from "./chat-slash-commands";
import { useComposerFiles } from "./use-composer-files";
import type { ComposerTrigger } from "./use-composer-typeahead";
import { useRemoteBranches } from "./use-remote-branches";
import type { WorkspaceAgentContextValue } from "./workspace-controller";

/**
 * The slash menu's items and the context the submit-time interceptor reads.
 * Files load only while `/open` is being typed and GitHub branches only
 * while `/branch` is, so the menu costs nothing until it needs them.
 */
export function useChatSlashItems({
  trigger,
  agentContext,
  workspaceId,
  canEdit,
  hasGoal,
}: {
  trigger: ComposerTrigger | null;
  agentContext: WorkspaceAgentContextValue | null;
  workspaceId: string;
  canEdit: boolean;
  hasGoal: boolean;
}) {
  const command = trigger?.kind === "slash" ? trigger.command : null;
  const files = useComposerFiles(
    agentContext?.sources ?? null,
    command === "open",
  );
  const branches = useRemoteBranches(
    workspaceId,
    command === "branch" && agentContext !== null,
  );
  const snapshot = agentContext?.getSnapshot() ?? null;
  const context: SlashContext = {
    workspace: agentContext !== null,
    canEdit,
    previewEnabled: agentContext?.previewEnabled ?? false,
    hasGoal,
    currentWorktreeId: snapshot?.worktree.id ?? null,
    worktrees: snapshot?.worktrees ?? [],
    remoteBranches: branches.list?.branches.map((branch) => branch.name) ?? [],
    files: files.entries,
    knownPort: snapshot?.preview?.port ?? snapshot?.listeningPorts?.[0] ?? null,
  };
  const items =
    trigger?.kind === "slash" ? buildSlashItems(trigger, context) : [];
  return { items, context };
}
