import "server-only";

import {
  closeSandboxTerminal,
  pollSandboxTerminal,
  resizeSandboxTerminal,
  sendSandboxTerminalInput,
  startSandboxTerminal,
} from "../runtime/orchestrator-terminals";
import {
  closeSupersetTerminal,
  pollSupersetTerminal,
  resizeSupersetTerminal,
  sendSupersetTerminalInput,
  startSupersetTerminal,
} from "../runtime/orchestrator-superset-runtime";
import { canRunGen2Agent } from "./agent-policy";
import { Gen2LifecycleError } from "./errors";
import { requireGen2Member } from "./workspaces";
import { isGen2SupersetRuntimeEnabled } from "./superset-runtime-feature";

const PRIMARY_WORKTREE_ID = "main";

/**
 * A shell on the workspace's own machine — the same `/workspace` Codex edits.
 *
 * Only `start` needs the instance to be idle: the guest takes its mutation
 * lock to spawn a PTY and waits for any running Codex turn first. Input,
 * resize, poll, and close skip that wait entirely, which is why a terminal
 * opened before a turn keeps streaming straight through it. Those four are
 * member-only so a poll racing a Stop returns `exited` rather than a
 * confusing 409.
 */

async function requireReadyMember(workspaceId: string, userId: string) {
  const membership = await requireGen2Member(workspaceId, userId);
  if (!canRunGen2Agent(membership.status)) {
    throw new Gen2LifecycleError(
      membership.status === "provisioning"
        ? "The instance is still starting."
        : "Start the instance first.",
    );
  }
  return membership;
}

export async function startGen2Terminal(
  workspaceId: string,
  userId: string,
  size: { rows: number; columns: number; worktreeId?: string },
) {
  await requireReadyMember(workspaceId, userId);
  if (isGen2SupersetRuntimeEnabled()) {
    return startSupersetTerminal(workspaceId, {
      worktreeId: size.worktreeId ?? PRIMARY_WORKTREE_ID,
      rows: size.rows,
      columns: size.columns,
    });
  }
  return startSandboxTerminal(workspaceId, {
    rows: size.rows,
    columns: size.columns,
  });
}

/**
 * The runtime calls behind an already-authorized terminal, so a socket that
 * checked membership once does not repeat it for every keystroke.
 */
export function gen2TerminalBackend(
  workspaceId: string,
  worktreeId = PRIMARY_WORKTREE_ID,
) {
  if (isGen2SupersetRuntimeEnabled()) {
    return {
      input: (sessionId: string, data: string) =>
        sendSupersetTerminalInput(workspaceId, { worktreeId, sessionId, data }),
      resize: (sessionId: string, size: { rows: number; columns: number }) =>
        resizeSupersetTerminal(workspaceId, { worktreeId, sessionId, ...size }),
      poll: (sessionId: string, after: number) =>
        pollSupersetTerminal(workspaceId, { worktreeId, sessionId, after }),
      close: (sessionId: string) =>
        closeSupersetTerminal(workspaceId, { sessionId, worktreeId }),
    };
  }
  return {
    input: (sessionId: string, data: string) =>
      sendSandboxTerminalInput(workspaceId, sessionId, data),
    resize: (sessionId: string, size: { rows: number; columns: number }) =>
      resizeSandboxTerminal(workspaceId, sessionId, size),
    poll: (sessionId: string, after: number) =>
      pollSandboxTerminal(workspaceId, sessionId, after),
    close: (sessionId: string) => closeSandboxTerminal(workspaceId, sessionId),
  };
}

/** Membership and readiness, checked once when a stream socket opens. */
export async function authorizeGen2TerminalStream(
  workspaceId: string,
  userId: string,
) {
  await requireReadyMember(workspaceId, userId);
}

/** Cheaper recheck a long-lived socket repeats while it stays open. */
export async function recheckGen2TerminalMember(
  workspaceId: string,
  userId: string,
) {
  await requireGen2Member(workspaceId, userId);
}

export async function sendGen2TerminalInput(
  workspaceId: string,
  userId: string,
  sessionId: string,
  data: string,
  worktreeId = PRIMARY_WORKTREE_ID,
) {
  await requireGen2Member(workspaceId, userId);
  if (isGen2SupersetRuntimeEnabled()) {
    await sendSupersetTerminalInput(workspaceId, {
      worktreeId,
      sessionId,
      data,
    });
    return;
  }
  await sendSandboxTerminalInput(workspaceId, sessionId, data);
}

export async function resizeGen2Terminal(
  workspaceId: string,
  userId: string,
  sessionId: string,
  size: { rows: number; columns: number },
  worktreeId = PRIMARY_WORKTREE_ID,
) {
  await requireGen2Member(workspaceId, userId);
  if (isGen2SupersetRuntimeEnabled()) {
    await resizeSupersetTerminal(workspaceId, {
      worktreeId,
      sessionId,
      ...size,
    });
    return;
  }
  await resizeSandboxTerminal(workspaceId, sessionId, size);
}

export async function pollGen2Terminal(
  workspaceId: string,
  userId: string,
  sessionId: string,
  after: number,
  worktreeId = PRIMARY_WORKTREE_ID,
) {
  await requireGen2Member(workspaceId, userId);
  if (isGen2SupersetRuntimeEnabled()) {
    return pollSupersetTerminal(workspaceId, {
      worktreeId,
      sessionId,
      after,
    });
  }
  return pollSandboxTerminal(workspaceId, sessionId, after);
}

export async function closeGen2Terminal(
  workspaceId: string,
  userId: string,
  sessionId: string,
  worktreeId = PRIMARY_WORKTREE_ID,
) {
  await requireGen2Member(workspaceId, userId);
  if (isGen2SupersetRuntimeEnabled()) {
    await closeSupersetTerminal(workspaceId, { sessionId, worktreeId });
    return;
  }
  await closeSandboxTerminal(workspaceId, sessionId);
}
