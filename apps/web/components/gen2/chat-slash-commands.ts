import type { Gen2SupersetEntry } from "@codev/contracts";

import { GEN2_PROMPT_COMMANDS } from "@/lib/gen2/prompt-command";
import { slashArgumentItems } from "./chat-slash-arguments";
import {
  availableWorkspaceCommands,
  workspaceCommandAction,
} from "./chat-workspace-commands";
import type {
  ComposerMenuItem,
  ComposerTrigger,
} from "./use-composer-typeahead";

/** What the slash menu knows about the workspace when it opens. */
export type SlashContext = {
  /** The chat runs inside the workspace shell, so workspace commands work. */
  workspace: boolean;
  canEdit: boolean;
  previewEnabled: boolean;
  hasGoal: boolean;
  currentWorktreeId: string | null;
  worktrees: Array<{ id: string; branch: string }>;
  /** GitHub's branch names; null until they load. */
  remoteBranches: string[] | null;
  /** Why GitHub's branches couldn't load, when they couldn't. */
  remoteError: string | null;
  /** Private repositories are copied without their other branches. */
  repositoryPrivate: boolean;
  files: Gen2SupersetEntry[] | null;
  knownPort: number | null;
};

function nameItems(query: string, context: SlashContext): ComposerMenuItem[] {
  const prefix = query.toLowerCase();
  const editor = context.canEdit;
  const agent = GEN2_PROMPT_COMMANDS.filter(
    (command) => editor && command.id.startsWith(prefix),
  ).map<ComposerMenuItem>((command) => ({
    id: `agent-${command.id}`,
    group: "Agent",
    label: `/${command.id}`,
    detail: command.description,
    icon: command.id,
    action: { type: "insert", text: `/${command.id} ` },
  }));
  const goal: ComposerMenuItem[] =
    editor && context.hasGoal && "goal".startsWith(prefix)
      ? [
          {
            id: "goal-done",
            group: "Goal",
            label: "/goal done",
            detail: "Mark the goal achieved",
            icon: "goal",
            action: { type: "send", prompt: "/goal done" },
          },
          {
            id: "goal-clear",
            group: "Goal",
            label: "/goal clear",
            detail: "Clear this chat’s goal",
            icon: "goal",
            action: { type: "send", prompt: "/goal clear" },
          },
        ]
      : [];
  const workspace = availableWorkspaceCommands(context)
    .filter((command) => command.id.startsWith(prefix))
    .map<ComposerMenuItem>((command) => ({
      id: `workspace-${command.id}`,
      group: "Workspace",
      label: `/${command.id}`,
      detail: command.detail,
      icon: command.icon,
      action: workspaceCommandAction(command.id, context),
    }));
  return [...agent, ...goal, ...workspace];
}

/** The slash menu for the text at the caret: names first, then arguments. */
export function buildSlashItems(
  trigger: ComposerTrigger,
  context: SlashContext,
): ComposerMenuItem[] {
  if (!trigger.command) return nameItems(trigger.query, context);
  const command = availableWorkspaceCommands(context).find(
    (entry) => entry.id === trigger.command,
  );
  return command
    ? slashArgumentItems(command.id, trigger.query.trim(), context)
    : [];
}
