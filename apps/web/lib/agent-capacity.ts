import {
  agentCapacitySchema,
  MAX_PARALLEL_AGENT_SESSIONS,
} from "@codev/contracts";

export type AgentCapacitySession = {
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

export function assertAgentCapacity(activeSessions: number) {
  if (activeSessions >= MAX_PARALLEL_AGENT_SESSIONS) {
    throw new AgentCapacityError();
  }
}

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
