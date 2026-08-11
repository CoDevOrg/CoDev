import {
  agentCapacitySchema,
  MAX_PARALLEL_AGENT_SESSIONS,
} from "@codev/contracts";

export type AgentCapacitySession = {
  worktreeStatus: string;
};

export function summarizeAgentCapacity(sessions: AgentCapacitySession[]) {
  const activeSessions = sessions.filter(
    (session) =>
      session.worktreeStatus === "active" ||
      session.worktreeStatus === "frozen",
  ).length;

  return agentCapacitySchema.parse({
    maxActiveSessions: MAX_PARALLEL_AGENT_SESSIONS,
    activeSessions,
    availableSlots: Math.max(0, MAX_PARALLEL_AGENT_SESSIONS - activeSessions),
  });
}
