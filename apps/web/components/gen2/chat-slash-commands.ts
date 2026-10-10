import {
  gen2BranchNameSchema,
  gen2RelativePathSchema,
  type Gen2SupersetEntry,
  type Gen2WorkspaceAction,
} from "@codev/contracts";

import { GEN2_PROMPT_COMMANDS } from "@/lib/gen2/prompt-command";
import { slashArgumentItems } from "./chat-slash-arguments";
import type {
  ComposerMenuAction,
  ComposerMenuIcon,
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
  remoteBranches: string[];
  files: Gen2SupersetEntry[] | null;
  knownPort: number | null;
};

type WorkspaceCommand = {
  id: string;
  detail: string;
  icon: ComposerMenuIcon;
  editorOnly?: boolean;
  previewOnly?: boolean;
  argument?: "required" | "optional";
};

const WORKSPACE_COMMANDS: WorkspaceCommand[] = [
  {
    id: "open",
    detail: "Open a file in Files",
    icon: "file",
    argument: "required",
  },
  { id: "changes", detail: "Show this worktree’s changes", icon: "changes" },
  { id: "diff", detail: "Review the uncommitted diff", icon: "review" },
  {
    id: "terminal",
    detail: "Open the terminal",
    icon: "terminal",
    editorOnly: true,
  },
  {
    id: "preview",
    detail: "Preview your app in the browser",
    icon: "preview",
    editorOnly: true,
    previewOnly: true,
    argument: "optional",
  },
  {
    id: "branch",
    detail: "Switch, open or create a branch",
    icon: "branch",
    editorOnly: true,
    argument: "required",
  },
  {
    id: "share",
    detail: "Share this workspace",
    icon: "share",
    editorOnly: true,
    argument: "optional",
  },
  { id: "new", detail: "Start a new chat", icon: "new", editorOnly: true },
  {
    id: "rename",
    detail: "Rename this chat",
    icon: "rename",
    editorOnly: true,
    argument: "required",
  },
  { id: "board", detail: "Show the board of worktrees", icon: "board" },
  { id: "settings", detail: "Open your settings", icon: "settings" },
  {
    id: "import",
    detail: "Import a local agent session",
    icon: "import",
    editorOnly: true,
  },
];

const USAGE: Record<string, string> = {
  open: "Name a file to open, like /open src/app.ts.",
  branch: "Name a branch, like /branch feat/login.",
  rename: "Add a title, like /rename Fix the login flow.",
  preview: "Add a port, like /preview 3000.",
};

const run = (action: Gen2WorkspaceAction): ComposerMenuAction => ({
  type: "run",
  action,
});

function available(context: SlashContext) {
  if (!context.workspace) return [];
  return WORKSPACE_COMMANDS.filter(
    (command) =>
      (context.canEdit || !command.editorOnly) &&
      (context.previewEnabled || !command.previewOnly),
  );
}

function commandAction(id: string, context: SlashContext): ComposerMenuAction {
  const port = context.knownPort;
  switch (id) {
    case "changes":
      return run({ type: "show_changes" });
    case "diff":
      return run({ type: "open_review" });
    case "terminal":
      return run({ type: "open_terminal" });
    case "share":
      return run({ type: "open_share" });
    case "preview":
      return port
        ? run({ type: "open_preview", port })
        : { type: "insert", text: "/preview " };
    case "new":
    case "board":
    case "settings":
    case "import":
      return { type: "workspace", command: id };
    default:
      return { type: "insert", text: `/${id} ` };
  }
}

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
  const workspace = available(context)
    .filter((command) => command.id.startsWith(prefix))
    .map<ComposerMenuItem>((command) => ({
      id: `workspace-${command.id}`,
      group: "Workspace",
      label: `/${command.id}`,
      detail: command.detail,
      icon: command.icon,
      action: commandAction(command.id, context),
    }));
  return [...agent, ...goal, ...workspace];
}

/** The slash menu for the text at the caret: names first, then arguments. */
export function buildSlashItems(
  trigger: ComposerTrigger,
  context: SlashContext,
): ComposerMenuItem[] {
  if (!trigger.command) return nameItems(trigger.query, context);
  const command = available(context).find(
    (entry) => entry.id === trigger.command,
  );
  return command
    ? slashArgumentItems(command.id, trigger.query.trim(), context)
    : [];
}

function exactBranchAction(
  value: string,
  context: SlashContext,
): ComposerMenuAction {
  const worktree = context.worktrees.find((entry) => entry.branch === value);
  if (worktree)
    return worktree.id === context.currentWorktreeId
      ? { type: "notice", message: `You’re already on ${value}.` }
      : run({ type: "switch_worktree", worktreeId: worktree.id });
  if (context.remoteBranches.includes(value))
    return run({ type: "open_branch", branch: value });
  return gen2BranchNameSchema.safeParse(value).success
    ? run({ type: "create_branch", branch: value })
    : { type: "notice", message: "That isn’t a valid branch name." };
}

/**
 * The submit-time interceptor: a prompt that is exactly a workspace command
 * (`/branch feat-x`, `/changes`) runs it instead of starting a turn, even
 * when the menu is closed. Anything else, including `/goal`, is sent.
 */
export function parseWorkspaceCommand(
  text: string,
  context: SlashContext,
): ComposerMenuAction | null {
  const match = /^\/([a-z]+)(?:[ \t]+(.+))?$/i.exec(text.trim());
  const id = match?.[1]?.toLowerCase();
  const command = available(context).find((entry) => entry.id === id);
  if (!match || !command) return null;
  const value = (match[2] ?? "").trim();
  if (value && !command.argument) return null;
  if (!value) {
    const action = commandAction(command.id, context);
    return action.type === "insert"
      ? {
          type: "notice",
          message: USAGE[command.id] ?? `Add to /${command.id}.`,
        }
      : action;
  }
  if (command.id === "branch") return exactBranchAction(value, context);
  if (command.id === "open")
    return gen2RelativePathSchema.safeParse(value).success
      ? run({ type: "open_file", path: value })
      : { type: "notice", message: USAGE.open! };
  const first = slashArgumentItems(command.id, value, context)[0];
  return first?.action ?? { type: "notice", message: USAGE[command.id] ?? "" };
}
