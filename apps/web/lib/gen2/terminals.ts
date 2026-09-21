import "server-only";

import {
  closeSandboxTerminal,
  pollSandboxTerminal,
  resizeSandboxTerminal,
  sendSandboxTerminalInput,
  startSandboxTerminal,
} from "../runtime/orchestrator-terminals";
import { canRunGen2Agent } from "./agent-policy";
import { Gen2LifecycleError } from "./errors";
import { requireGen2Member } from "./workspaces";

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
  size: { rows: number; columns: number },
) {
  await requireReadyMember(workspaceId, userId);
  return startSandboxTerminal(workspaceId, size);
}

export async function sendGen2TerminalInput(
  workspaceId: string,
  userId: string,
  sessionId: string,
  data: string,
) {
  await requireGen2Member(workspaceId, userId);
  await sendSandboxTerminalInput(workspaceId, sessionId, data);
}

export async function resizeGen2Terminal(
  workspaceId: string,
  userId: string,
  sessionId: string,
  size: { rows: number; columns: number },
) {
  await requireGen2Member(workspaceId, userId);
  await resizeSandboxTerminal(workspaceId, sessionId, size);
}

export async function pollGen2Terminal(
  workspaceId: string,
  userId: string,
  sessionId: string,
  after: number,
) {
  await requireGen2Member(workspaceId, userId);
  return pollSandboxTerminal(workspaceId, sessionId, after);
}

export async function closeGen2Terminal(
  workspaceId: string,
  userId: string,
  sessionId: string,
) {
  await requireGen2Member(workspaceId, userId);
  await closeSandboxTerminal(workspaceId, sessionId);
}
