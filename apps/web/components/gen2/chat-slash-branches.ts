import { gen2BranchNameSchema } from "@codev/contracts";

import type { SlashContext } from "./chat-slash-commands";
import type {
  ComposerMenuAction,
  ComposerMenuItem,
} from "./use-composer-typeahead";

type Row = Omit<ComposerMenuItem, "group" | "icon"> & {
  icon?: ComposerMenuItem["icon"] | undefined;
};

const row = ({ icon, ...item }: Row): ComposerMenuItem => ({
  group: "Branches",
  icon: icon ?? "branch",
  ...item,
});

const notice = (message: string): ComposerMenuAction => ({
  type: "notice",
  message,
});

function switchRow(worktree: { id: string; branch: string }) {
  return row({
    id: `switch-${worktree.id}`,
    label: `Switch to ${worktree.branch}`,
    detail: "Open worktree",
    action: {
      type: "run",
      action: { type: "switch_worktree", worktreeId: worktree.id },
    },
  });
}

/** Private repositories are copied without their other branches. */
function remoteRow(name: string, context: SlashContext) {
  const label = `Open ${name}`;
  if (context.repositoryPrivate)
    return row({
      id: `open-${name}`,
      label,
      detail: "Not available for private repositories",
      disabled: true,
      action: notice(
        `Private repositories are copied without their other branches, so ${name} can’t be opened here yet.`,
      ),
    });
  return row({
    id: `open-${name}`,
    label,
    detail: "From GitHub",
    action: { type: "run", action: { type: "open_branch", branch: name } },
  });
}

/** A row while GitHub's list is unknown, so nothing offers to create. */
function remoteStatusRow(context: SlashContext) {
  if (context.remoteError !== null)
    return row({
      id: "remote-retry",
      label: "Couldn’t load GitHub branches · Retry",
      detail: context.remoteError,
      action: { type: "retry" },
    });
  if (context.remoteBranches !== null) return null;
  return row({
    id: "remote-loading",
    label: "Loading branches from GitHub…",
    disabled: true,
    action: notice(
      "Still loading branches from GitHub. Try again in a moment.",
    ),
  });
}

/** The row the typed name means: Enter runs it, and so does Send. */
function exactRow(value: string, context: SlashContext) {
  const worktree = context.worktrees.find((entry) => entry.branch === value);
  if (worktree && worktree.id === context.currentWorktreeId)
    return row({
      id: `switch-${worktree.id}`,
      label: `Already on ${value}`,
      detail: "Current worktree",
      disabled: true,
      action: notice(`You’re already on ${value}.`),
    });
  if (worktree) return switchRow(worktree);
  const status = remoteStatusRow(context);
  if (status) return status;
  if (context.remoteBranches?.includes(value)) return remoteRow(value, context);
  if (!gen2BranchNameSchema.safeParse(value).success)
    return row({
      id: "invalid",
      label: "Not a valid branch name",
      disabled: true,
      action: notice("That isn’t a valid branch name."),
    });
  return row({
    id: "create",
    label: `Create branch ${value}`,
    detail: "In a new worktree",
    icon: "create",
    action: { type: "run", action: { type: "create_branch", branch: value } },
  });
}

/**
 * The `/branch` menu. A typed name's own row comes first — its worktree, its
 * GitHub branch or a new branch — so Enter does what Send would; other
 * worktrees and GitHub branches that contain it follow. "Create" waits until
 * GitHub's list has loaded, so an existing branch is never recreated.
 */
export function slashBranchItems(
  value: string,
  context: SlashContext,
): ComposerMenuItem[] {
  const needle = value.toLowerCase();
  const matches = (name: string) => name.toLowerCase().includes(needle);
  const open = new Set(context.worktrees.map((worktree) => worktree.branch));
  const lead = value ? exactRow(value, context) : null;
  const worktrees = context.worktrees
    .filter((entry) => entry.id !== context.currentWorktreeId)
    .filter((entry) => matches(entry.branch))
    .slice(0, 5)
    .map(switchRow);
  const remote = (context.remoteBranches ?? [])
    .filter((name) => !open.has(name) && matches(name))
    .slice(0, 8)
    .map((name) => remoteRow(name, context));
  const status = remoteStatusRow(context);
  const rest = [...worktrees, ...remote, ...(status ? [status] : [])];
  return lead ? [lead, ...rest.filter((item) => item.id !== lead.id)] : rest;
}
