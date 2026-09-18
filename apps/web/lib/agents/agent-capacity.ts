import {
  agentCapacitySchema,
  MAX_PARALLEL_AGENT_SESSIONS,
} from "@codev/contracts";

/**
 * A capacity slot is a worktree, not a conversation.
 *
 * Several chat threads can share one worktree: when a thread grows long
 * enough that the model's context is the bottleneck, a member starts a fresh
 * chat on the same branch rather than a whole new agent. That costs no extra
 * checkout, no extra VM workload, and no extra running process, so it must
 * not consume a slot. What the cap bounds is how many worktrees a workspace
 * keeps live at once.
 */
export type AgentCapacitySession = {
  worktreeId: string;
  worktreeStatus: string;
};

export const AGENT_CAPACITY_EXCEEDED_MESSAGE =
  "All three agent slots are in use. Stop or wait for an active session to finish before starting another.";

export class AgentCapacityError extends Error {
  constructor() {
    super(AGENT_CAPACITY_EXCEEDED_MESSAGE);
    this.name = "AgentCapacityError";
  }
}

export function assertAgentCapacity(activeWorktrees: number) {
  if (activeWorktrees >= MAX_PARALLEL_AGENT_SESSIONS) {
    throw new AgentCapacityError();
  }
}

export function liveAgentWorktreeIds(
  sessions: AgentCapacitySession[],
): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const session of sessions) {
    if (
      session.worktreeStatus !== "active" &&
      session.worktreeStatus !== "frozen"
    ) {
      continue;
    }
    if (seen.has(session.worktreeId)) continue;
    seen.add(session.worktreeId);
    ordered.push(session.worktreeId);
  }
  return ordered;
}

export function summarizeAgentCapacity(sessions: AgentCapacitySession[]) {
  const activeSessions = liveAgentWorktreeIds(sessions).length;

  return agentCapacitySchema.parse({
    maxActiveSessions: MAX_PARALLEL_AGENT_SESSIONS,
    activeSessions,
    availableSlots: Math.max(0, MAX_PARALLEL_AGENT_SESSIONS - activeSessions),
  });
}
