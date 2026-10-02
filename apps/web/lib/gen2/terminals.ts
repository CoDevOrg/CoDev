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

interface MemberCacheEntry {
  expiresAt: number;
  data: Awaited<ReturnType<typeof requireGen2Member>>;
}

const memberCache = new Map<string, MemberCacheEntry>();
const TERMINAL_MEMBER_CACHE_TTL_MS = 60_000;

export function clearGen2TerminalMemberCache() {
  memberCache.clear();
}

export function invalidateGen2TerminalMemberCache(
  workspaceId: string,
  userId: string,
) {
  memberCache.delete(`${workspaceId}:${userId}`);
}

async function getCachedGen2Member(workspaceId: string, userId: string) {
  const cacheKey = `${workspaceId}:${userId}`;
  const now = Date.now();
  const cached = memberCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.data;
  }
  const membership = await requireGen2Member(workspaceId, userId);
  memberCache.set(cacheKey, {
    expiresAt: now + TERMINAL_MEMBER_CACHE_TTL_MS,
    data: membership,
  });
  return membership;
}

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
  memberCache.set(`${workspaceId}:${userId}`, {
    expiresAt: Date.now() + TERMINAL_MEMBER_CACHE_TTL_MS,
    data: membership,
  });
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

export async function sendGen2TerminalInput(
  workspaceId: string,
  userId: string,
  sessionId: string,
  data: string,
  worktreeId = PRIMARY_WORKTREE_ID,
) {
  await getCachedGen2Member(workspaceId, userId);
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
  await getCachedGen2Member(workspaceId, userId);
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
  await getCachedGen2Member(workspaceId, userId);
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
  try {
    await getCachedGen2Member(workspaceId, userId);
    if (isGen2SupersetRuntimeEnabled()) {
      await closeSupersetTerminal(workspaceId, { sessionId, worktreeId });
      return;
    }
    await closeSandboxTerminal(workspaceId, sessionId);
  } finally {
    invalidateGen2TerminalMemberCache(workspaceId, userId);
  }
}
