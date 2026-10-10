"use client";

import { buildSlashItems, type SlashContext } from "./chat-slash-commands";
import { useComposerFiles } from "./use-composer-files";
import type { ComposerTrigger } from "./use-composer-typeahead";
import { useRemoteBranches } from "./use-remote-branches";
import type { WorkspaceAgentContextValue } from "./workspace-controller";

const BRANCH_COMMAND = /^\/branch\s/i;

/**
 * The slash menu's items and the context the submit-time interceptor reads.
 * Files load only while `/open` is being typed and GitHub branches only
 * while the prompt is a `/branch` command, so the menu costs nothing until
 * it needs them.
 */
export function useChatSlashItems({
  trigger,
  text,
  agentContext,
  workspaceId,
  repositoryPrivate,
  canEdit,
  hasGoal,
}: {
  trigger: ComposerTrigger | null;
  text: string;
  agentContext: WorkspaceAgentContextValue | null;
  workspaceId: string;
  repositoryPrivate: boolean;
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
    agentContext !== null &&
      (command === "branch" || BRANCH_COMMAND.test(text)),
  );
  const snapshot = agentContext?.getSnapshot() ?? null;
  const context: SlashContext = {
    workspace: agentContext !== null,
    canEdit,
    previewEnabled: agentContext?.previewEnabled ?? false,
    hasGoal,
    currentWorktreeId: snapshot?.worktree.id ?? null,
    worktrees: snapshot?.worktrees ?? [],
    remoteBranches: branches.list?.branches.map((entry) => entry.name) ?? null,
    remoteError:
      branches.status === "error" && !branches.list ? branches.error : null,
    repositoryPrivate,
    files: files.entries,
    knownPort: snapshot?.preview?.port ?? snapshot?.listeningPorts?.[0] ?? null,
  };
  const items =
    trigger?.kind === "slash" ? buildSlashItems(trigger, context) : [];
  return { items, context, retry: () => void branches.reload() };
}
