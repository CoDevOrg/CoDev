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
import { Gen2AccessError, Gen2LifecycleError } from "./errors";
import { requireWorkspaceOwnerPlan } from "../billing/gate";
import { requireGen2Member } from "./workspaces";
import { isGen2SupersetRuntimeEnabled } from "./superset-runtime-feature";
import type { Gen2TerminalAccess } from "./terminal-access";
import { runtimeTargetFromRow } from "../runtime/workspace-runtime-target";

const PRIMARY_WORKTREE_ID = "main";

function requireTerminalPermission(
  membership: Awaited<ReturnType<typeof requireGen2Member>>,
) {
  if (membership.role === "viewer") {
    throw new Gen2AccessError(
      "Edit permission is required to access terminals.",
      403,
    );
  }
  return membership;
}

async function requireTerminalMember(workspaceId: string, userId: string) {
  return requireTerminalPermission(
    await requireGen2Member(workspaceId, userId),
  );
}

/**
 * A shell on the workspace's own machine — the same `/workspace` Codex edits.
 *
 * Only `start` needs the instance to be idle: the guest takes its mutation
 * lock to spawn a PTY and waits for any running Codex turn first. Input,
 * resize, poll, and close skip that wait entirely, which is why a terminal
 * opened before a turn keeps streaming straight through it. Those four are
 * editor/owner-only so a poll racing a Stop returns `exited` rather than a
 * confusing 409.
 */

async function requireReadyMember(workspaceId: string, userId: string) {
  const membership = requireTerminalPermission(
    await requireGen2Member(workspaceId, userId),
  );
  if (!canRunGen2Agent(membership.status)) {
    throw new Gen2LifecycleError(
      membership.status === "pending" || membership.status === "provisioning"
        ? "The workspace is still starting."
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
  await requireWorkspaceOwnerPlan(workspaceId);
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
 * The runtime calls behind a terminal socket. Each call takes the access its
 * caller just checked and routes with it instead of reading the route again.
 * Marwan's stream (320c5f27) uses this.
 */
export function gen2TerminalBackend(
  workspaceId: string,
  worktreeId = PRIMARY_WORKTREE_ID,
) {
  if (isGen2SupersetRuntimeEnabled()) {
    const route = (access: Gen2TerminalAccess) =>
      runtimeTargetFromRow(workspaceId, access);
    return {
      input: async (
        sessionId: string,
        data: string,
        access: Gen2TerminalAccess,
      ) =>
        sendSupersetTerminalInput(
          workspaceId,
          { worktreeId, sessionId, data },
          await route(access),
        ),
      resize: async (
        sessionId: string,
        size: { rows: number; columns: number },
        access: Gen2TerminalAccess,
      ) =>
        resizeSupersetTerminal(
          workspaceId,
          { worktreeId, sessionId, rows: size.rows, columns: size.columns },
          await route(access),
        ),
      poll: async (
        sessionId: string,
        after: number,
        access: Gen2TerminalAccess,
      ) =>
        pollSupersetTerminal(
          workspaceId,
          { worktreeId, sessionId, after },
          await route(access),
        ),
      close: (sessionId: string) =>
        closeSupersetTerminal(workspaceId, { sessionId, worktreeId }),
    };
  }
  return {
    input: (sessionId: string, data: string) =>
      sendSandboxTerminalInput(workspaceId, sessionId, data),
    resize: (sessionId: string, size: { rows: number; columns: number }) =>
      resizeSandboxTerminal(workspaceId, sessionId, {
        rows: size.rows,
        columns: size.columns,
      }),
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

export async function sendGen2TerminalInput(
  workspaceId: string,
  userId: string,
  sessionId: string,
  data: string,
  worktreeId = PRIMARY_WORKTREE_ID,
) {
  await requireTerminalMember(workspaceId, userId);
  await requireWorkspaceOwnerPlan(workspaceId);
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
  await requireTerminalMember(workspaceId, userId);
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
  await requireTerminalMember(workspaceId, userId);
  const result = isGen2SupersetRuntimeEnabled()
    ? await pollSupersetTerminal(workspaceId, { worktreeId, sessionId, after })
    : await pollSandboxTerminal(workspaceId, sessionId, after);
  await requireTerminalMember(workspaceId, userId);
  return result;
}

export async function closeGen2Terminal(
  workspaceId: string,
  userId: string,
  sessionId: string,
  worktreeId = PRIMARY_WORKTREE_ID,
) {
  await requireTerminalMember(workspaceId, userId);
  if (isGen2SupersetRuntimeEnabled()) {
    await closeSupersetTerminal(workspaceId, { sessionId, worktreeId });
    return;
  }
  await closeSandboxTerminal(workspaceId, sessionId);
}
