import "server-only";

import {
  closeSandboxTerminal,
  pollSandboxTerminal,
  resizeSandboxTerminal,
  sendSandboxTerminalInput,
  startSandboxTerminal,
} from "../runtime/orchestrator-terminals";
import { requireWorkspacePermission } from "../policies/workspace";
import { canRunGen2Agent } from "./agent-policy";
import { Gen2LifecycleError } from "./errors";
import { getGen2WorkspaceForAccess } from "./workspaces";

/**
 * A shell on the workspace's own machine — the same `/workspace` Codex edits.
 *
 * Only `start` needs the instance to be idle: the guest takes its mutation
 * lock to spawn a PTY and waits for any running Codex turn first. Input,
 * resize, poll, and close skip that wait entirely, which is why a terminal
 * opened before a turn keeps streaming straight through it. Those four require
 * `workspace.useTerminal`, so a poll racing a Stop returns `exited` rather
 * than a confusing 409. Terminal sessions are intentionally shared by every
 * terminal-capable workspace member; the orchestrator scopes each session id
 * under the workspace id in every request, so knowing an id alone is not
 * authority over another workspace.
 */

async function requireReadyWorkspace(workspaceId: string, userId: string) {
  const access = await requireWorkspacePermission(
    workspaceId,
    userId,
    "workspace.useTerminal",
  );
  const workspace = await getGen2WorkspaceForAccess(workspaceId, access);
  if (!canRunGen2Agent(workspace.status)) {
    throw new Gen2LifecycleError(
      workspace.status === "provisioning"
        ? "The instance is still starting."
        : "Start the instance first.",
    );
  }
  return workspace;
}

export async function startGen2Terminal(
  workspaceId: string,
  userId: string,
  size: { rows: number; columns: number },
) {
  await requireReadyWorkspace(workspaceId, userId);
  return startSandboxTerminal(workspaceId, size);
}

export async function sendGen2TerminalInput(
  workspaceId: string,
  userId: string,
  sessionId: string,
  data: string,
) {
  await requireWorkspacePermission(
    workspaceId,
    userId,
    "workspace.useTerminal",
  );
  await sendSandboxTerminalInput(workspaceId, sessionId, data);
}

export async function resizeGen2Terminal(
  workspaceId: string,
  userId: string,
  sessionId: string,
  size: { rows: number; columns: number },
) {
  await requireWorkspacePermission(
    workspaceId,
    userId,
    "workspace.useTerminal",
  );
  await resizeSandboxTerminal(workspaceId, sessionId, size);
}

export async function pollGen2Terminal(
  workspaceId: string,
  userId: string,
  sessionId: string,
  after: number,
) {
  await requireWorkspacePermission(
    workspaceId,
    userId,
    "workspace.useTerminal",
  );
  return pollSandboxTerminal(workspaceId, sessionId, after);
}

export async function closeGen2Terminal(
  workspaceId: string,
  userId: string,
  sessionId: string,
) {
  await requireWorkspacePermission(
    workspaceId,
    userId,
    "workspace.useTerminal",
  );
  await closeSandboxTerminal(workspaceId, sessionId);
}
