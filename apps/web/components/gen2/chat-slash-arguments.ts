import {
  gen2BranchNameSchema,
  gen2RelativePathSchema,
  type Gen2WorkspaceAction,
} from "@codev/contracts";

import { matchComposerFiles } from "./chat-file-match";
import type { SlashContext } from "./chat-slash-commands";
import type {
  ComposerMenuAction,
  ComposerMenuItem,
} from "./use-composer-typeahead";

const run = (action: Gen2WorkspaceAction): ComposerMenuAction => ({
  type: "run",
  action,
});

function exactFirst(value: string) {
  return (left: string, right: string) =>
    Number(right === value) - Number(left === value);
}

function branchItems(value: string, context: SlashContext): ComposerMenuItem[] {
  const needle = value.toLowerCase();
  const open = new Set(context.worktrees.map((worktree) => worktree.branch));
  const worktrees = context.worktrees
    .filter(
      (worktree) =>
        worktree.id !== context.currentWorktreeId &&
        worktree.branch.toLowerCase().includes(needle),
    )
    .sort((left, right) => exactFirst(value)(left.branch, right.branch))
    .slice(0, 5)
    .map<ComposerMenuItem>((worktree) => ({
      id: `switch-${worktree.id}`,
      group: "Branches",
      label: `Switch to ${worktree.branch}`,
      detail: "Open worktree",
      icon: "branch",
      action: run({ type: "switch_worktree", worktreeId: worktree.id }),
    }));
  const remote = context.remoteBranches
    .filter((name) => !open.has(name) && name.toLowerCase().includes(needle))
    .sort(exactFirst(value))
    .slice(0, 8)
    .map<ComposerMenuItem>((name) => ({
      id: `open-${name}`,
      group: "Branches",
      label: `Open ${name}`,
      detail: "From GitHub",
      icon: "branch",
      action: run({ type: "open_branch", branch: name }),
    }));
  const known = open.has(value) || context.remoteBranches.includes(value);
  const create: ComposerMenuItem[] =
    value && !known && gen2BranchNameSchema.safeParse(value).success
      ? [
          {
            id: "create",
            group: "Branches",
            label: `Create branch ${value}`,
            detail: "In a new worktree",
            icon: "create",
            action: run({ type: "create_branch", branch: value }),
          },
        ]
      : [];
  return [...worktrees, ...remote, ...create];
}

function fileItems(value: string, context: SlashContext): ComposerMenuItem[] {
  const valid = gen2RelativePathSchema.safeParse(value).success;
  if (!context.files)
    return value && valid
      ? [
          {
            id: "open-path",
            group: "Files",
            label: `Open ${value}`,
            icon: "file",
            action: run({ type: "open_file", path: value }),
          },
        ]
      : [];
  const files = context.files.filter((entry) => entry.kind === "file");
  return matchComposerFiles(files, value, 8).map((entry) => ({
    id: `open-${entry.path}`,
    group: "Files",
    label: entry.path,
    icon: "file",
    action: run({ type: "open_file", path: entry.path }),
  }));
}

/** The menu while a workspace command's argument is typed. */
export function slashArgumentItems(
  command: string,
  value: string,
  context: SlashContext,
): ComposerMenuItem[] {
  const port = /^\d{1,5}$/.test(value)
    ? Number(value)
    : (context.knownPort ?? 0);
  switch (command) {
    case "open":
      return fileItems(value, context);
    case "branch":
      return branchItems(value, context);
    case "rename":
      return value
        ? [
            {
              id: "rename",
              group: "Workspace",
              label: `Rename this chat to “${value.slice(0, 80)}”`,
              icon: "rename",
              action: run({ type: "rename_chat", title: value.slice(0, 80) }),
            },
          ]
        : [];
    case "share":
      return [
        {
          id: "share",
          group: "Workspace",
          label: value ? `Share with ${value}` : "Open Share",
          icon: "share",
          action: run({
            type: "open_share",
            ...(value ? { emailOrLogin: value.slice(0, 256) } : {}),
          }),
        },
      ];
    case "preview":
      return port >= 1 && port <= 65_535 && (!value || port === Number(value))
        ? [
            {
              id: "preview",
              group: "Workspace",
              label: `Preview :${port}`,
              icon: "preview",
              action: run({ type: "open_preview", port }),
            },
          ]
        : [];
    default:
      return [];
  }
}
