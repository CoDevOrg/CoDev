import {
  gen2RelativePathSchema,
  type Gen2WorkspaceAction,
} from "@codev/contracts";

import { slashArgumentItems } from "./chat-slash-arguments";
import { slashBranchItems } from "./chat-slash-branches";
import type { SlashContext } from "./chat-slash-commands";
import type {
  ComposerMenuAction,
  ComposerMenuIcon,
} from "./use-composer-typeahead";

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

const notice = (message: string): ComposerMenuAction => ({
  type: "notice",
  message,
});

/** The workspace commands this member can run here. */
export function availableWorkspaceCommands(context: SlashContext) {
  if (!context.workspace) return [];
  return WORKSPACE_COMMANDS.filter(
    (command) =>
      (context.canEdit || !command.editorOnly) &&
      (context.previewEnabled || !command.previewOnly),
  );
}

/** What choosing a command by name does: run it, or ask for its argument. */
export function workspaceCommandAction(
  id: string,
  context: SlashContext,
): ComposerMenuAction {
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

/** The action a command's argument means; the menu's first row agrees. */
function argumentAction(id: string, value: string, context: SlashContext) {
  if (id === "branch") {
    // The menu's first row is the typed name's own; a failed GitHub load
    // can only be retried from the open menu.
    const lead = slashBranchItems(value, context)[0]!;
    return lead.action.type === "retry"
      ? notice(context.remoteError ?? "Couldn’t load branches from GitHub.")
      : lead.action;
  }
  if (id === "open")
    return gen2RelativePathSchema.safeParse(value).success
      ? run({ type: "open_file", path: value })
      : notice(USAGE.open!);
  const first = slashArgumentItems(id, value, context)[0];
  return first?.action ?? notice(USAGE[id] ?? "");
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
  const command = availableWorkspaceCommands(context).find(
    (entry) => entry.id === id,
  );
  if (!match || !command) return null;
  const value = (match[2] ?? "").trim();
  if (value && !command.argument) return null;
  if (value) return argumentAction(command.id, value, context);
  const action = workspaceCommandAction(command.id, context);
  return action.type === "insert"
    ? notice(USAGE[command.id] ?? `Add to /${command.id}.`)
    : action;
}
