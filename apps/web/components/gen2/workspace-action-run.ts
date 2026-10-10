import {
  GEN2_AGENT_PROVIDERS,
  type Gen2AgentProviderName,
  type Gen2Chat,
  type Gen2SupersetWorktree,
  type Gen2WorkspaceAction,
} from "@codev/contracts";

import { formatGen2MentionToken } from "@/lib/gen2/prompt-mentions";
import { branchBaseFor, createWorktreeFrom } from "./create-worktree";
import { openRemoteBranch } from "./open-remote-branch";
import { SupersetFileApiError } from "./superset-file-client";
import { workspaceActionCopy } from "./workspace-action-copy";
import { inviteWorkspaceMembers } from "./workspace-action-invite";
import type { WorkspaceActionResult } from "./workspace-controller";

export type WorkspaceInspectorTab = "files" | "changes" | "review" | "browser";

/** What an action needs to know about the workspace as the member sees it. */
export type WorkspaceActionView = {
  canEdit: boolean;
  previewEnabled: boolean;
  viewMode: "ide" | "board";
  narrow: boolean;
  worktreeId: string;
  worktrees: Gen2SupersetWorktree[];
  dirty: boolean;
  openFilePath: string | null;
  listeningPorts: number[] | null;
  activeChat: { id: string; title: string } | null;
  activeProvider: Gen2AgentProviderName;
  connectedProviders: Gen2AgentProviderName[];
};

/** The shell operations an action is carried out with. */
export type WorkspaceActionOps = {
  workspaceId: string;
  view(): WorkspaceActionView;
  /** Shows an inspector tab; never pins the inspector open. */
  reveal(tab: WorkspaceInspectorTab): void;
  openFile(
    path: string,
    range: { line: number; endLine?: number } | null,
  ): void;
  refreshChanges(): void;
  focusReview(path: string | null): void;
  openTerminal(): void;
  openTerminalTab(worktreeId: string, command: string): void;
  requestPreview(port: number, path: string): void;
  selectWorktree(worktreeId: string): boolean;
  addWorktree(worktree: Gen2SupersetWorktree): void;
  openShare(emailOrLogin: string | null): void;
  openSettings(): void;
  createChat(provider: Gen2AgentProviderName): Promise<Gen2Chat | null>;
  setDraft(text: string): void;
  /** Resolves with an error message, or null once the server accepted it. */
  renameChat(title: string): Promise<string | null>;
};

const ok = (message: string): WorkspaceActionResult => ({ ok: true, message });
const fail = (message: string): WorkspaceActionResult => ({
  ok: false,
  message,
});
const EDITORS_ONLY = fail("Only editors can do this.");
const UNSAVED = fail(
  "You have unsaved changes. Save or discard them, then try again.",
);

function branchOf(view: WorkspaceActionView, worktreeId: string) {
  return (
    view.worktrees.find((worktree) => worktree.worktreeId === worktreeId)
      ?.branch ?? worktreeId
  );
}

function errorText(error: unknown, fallback: string) {
  if (error instanceof SupersetFileApiError && error.status === 503)
    return fallback;
  return error instanceof Error && error.message ? error.message : fallback;
}

function switchTo(ops: WorkspaceActionOps, worktreeId: string) {
  const view = ops.view();
  if (worktreeId === view.worktreeId) return null;
  if (!view.worktrees.some((worktree) => worktree.worktreeId === worktreeId))
    return fail(`${worktreeId} isn’t open on this workspace.`);
  return ops.selectWorktree(worktreeId) ? null : UNSAVED;
}

function reveal(
  action: Extract<
    Gen2WorkspaceAction,
    {
      type:
        | "open_file"
        | "show_changes"
        | "open_review"
        | "open_terminal"
        | "open_preview";
    }
  >,
  ops: WorkspaceActionOps,
) {
  if (action.type === "open_preview" && !ops.view().previewEnabled)
    return fail("Browser preview isn’t available in this workspace.");
  const target = "worktreeId" in action ? action.worktreeId : undefined;
  const switched = target ? switchTo(ops, target) : null;
  if (switched) return switched;
  if (action.type === "open_file") {
    ops.reveal("files");
    const { line, endLine } = action;
    ops.openFile(
      action.path,
      line ? { line, ...(endLine ? { endLine } : {}) } : null,
    );
  } else if (action.type === "show_changes" || action.type === "open_review") {
    ops.reveal(action.type === "show_changes" ? "changes" : "review");
    ops.refreshChanges();
    if (action.type === "open_review") ops.focusReview(action.path ?? null);
  } else if (action.type === "open_terminal") {
    ops.openTerminal();
  } else {
    ops.reveal("browser");
    ops.requestPreview(action.port, action.path ?? "/");
  }
  return ok(workspaceActionCopy(action).done);
}

async function openBranch(branch: string, ops: WorkspaceActionOps) {
  const view = ops.view();
  const existing = view.worktrees.find(
    (worktree) => worktree.branch === branch,
  );
  if (existing)
    return switchTo(ops, existing.worktreeId) ?? ok(`Switched to ${branch}`);
  try {
    const created = await openRemoteBranch(
      ops.workspaceId,
      branch,
      view.worktrees,
    );
    ops.addWorktree(created);
    return ops.selectWorktree(created.worktreeId)
      ? ok(`Opened ${created.branch} in a new worktree`)
      : ok(`Opened ${created.branch}. Your unsaved changes were kept.`);
  } catch (error) {
    return fail(errorText(error, `Couldn’t open ${branch}.`));
  }
}

async function createBranch(
  action: Extract<Gen2WorkspaceAction, { type: "create_branch" }>,
  ops: WorkspaceActionOps,
) {
  const view = ops.view();
  const existing = view.worktrees.find(
    (worktree) => worktree.branch === action.branch,
  );
  if (existing)
    return (
      switchTo(ops, existing.worktreeId) ?? ok(`Switched to ${action.branch}`)
    );
  const current = {
    worktreeId: view.worktreeId,
    branch: branchOf(view, view.worktreeId),
  };
  const { baseRef } = branchBaseFor(current, view.worktrees, action.baseRef);
  try {
    const created = await createWorktreeFrom(
      ops.workspaceId,
      { branch: action.branch, baseRef },
      view.worktrees,
    );
    ops.addWorktree(created);
    return ops.selectWorktree(created.worktreeId)
      ? ok(`Created ${created.branch} and switched to it`)
      : ok(`Created ${created.branch}. Your unsaved changes were kept.`);
  } catch (error) {
    return fail(errorText(error, "Couldn’t create this branch."));
  }
}

function runCommand(
  action: Extract<Gen2WorkspaceAction, { type: "run_in_terminal" }>,
  ops: WorkspaceActionOps,
) {
  const view = ops.view();
  const target = action.worktreeId ?? view.worktreeId;
  if (!view.worktrees.some((worktree) => worktree.worktreeId === target))
    return fail(`${target} isn’t open on this workspace.`);
  ops.openTerminalTab(target, action.command);
  ops.openTerminal();
  return target === view.worktreeId
    ? ok(`Running in a new terminal on ${branchOf(view, target)}`)
    : ok(
        `Runs in a new terminal on ${branchOf(view, target)} once you switch there`,
      );
}

async function startChat(
  action: Extract<Gen2WorkspaceAction, { type: "start_chat" }>,
  ops: WorkspaceActionOps,
) {
  const view = ops.view();
  const provider = action.provider ?? view.activeProvider;
  const label =
    GEN2_AGENT_PROVIDERS.find((entry) => entry.id === provider)?.label ??
    provider;
  if (!view.connectedProviders.includes(provider))
    return fail(`Connect ${label} in Settings first.`);
  const previous = view.activeChat;
  const chat = await ops.createChat(provider);
  if (!chat) return fail("Couldn’t start a new chat.");
  const mention = previous
    ? ` ${formatGen2MentionToken({ kind: "chat", ref: previous.id, label: previous.title })}`
    : "";
  ops.setDraft(`${action.prompt}${mention}`);
  return ok(`Started a new ${label} chat`);
}

/**
 * Carries out one action for the member. Auto-run navigation and clicks both
 * come through here; clicks may switch worktrees (through the shell's
 * unsaved-changes guard), auto runs never get that far because their
 * blocker stops them. Every mutation is also checked by the server.
 */
export async function runWorkspaceAction(
  action: Gen2WorkspaceAction,
  ops: WorkspaceActionOps,
): Promise<WorkspaceActionResult> {
  const canEdit = ops.view().canEdit;
  switch (action.type) {
    case "open_file":
    case "show_changes":
    case "open_review":
    case "open_terminal":
    case "open_preview":
      return reveal(action, ops);
    case "switch_worktree":
      return (
        switchTo(ops, action.worktreeId) ??
        ok(`Switched to ${branchOf(ops.view(), action.worktreeId)}`)
      );
    case "open_settings":
      ops.openSettings();
      return ok("Opened Settings");
    case "update_goal":
      return ok(workspaceActionCopy(action).done);
  }
  if (!canEdit) return EDITORS_ONLY;
  switch (action.type) {
    case "rename_chat": {
      const error = await ops.renameChat(action.title);
      return error ? fail(error) : ok(workspaceActionCopy(action).done);
    }
    case "open_branch":
      return openBranch(action.branch, ops);
    case "create_branch":
      return createBranch(action, ops);
    case "open_share":
      ops.openShare(action.emailOrLogin ?? null);
      return ok("Opened Share");
    case "invite_members":
      return inviteWorkspaceMembers(
        ops.workspaceId,
        action.people,
        action.role,
      );
    case "run_in_terminal":
      return runCommand(action, ops);
    case "start_chat":
      return startChat(action, ops);
  }
}
