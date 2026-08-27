/**
 * The shape Mission Control renders.
 *
 * Deliberately independent of any one API payload: the live workspace feeds it
 * from `/agents/workboard` + `/agents/shared`, and the demo surface feeds it
 * from a simulator. Both produce this, so the UI has exactly one contract.
 */

export type AgentPhase =
  | "planning"
  | "editing"
  | "testing"
  | "reviewing"
  | "blocked"
  | "waiting"
  | "done";

export type MissionControlMember = {
  id: string;
  name: string;
  initials: string;
  /** Stable hue so a person is the same colour everywhere on the surface. */
  hue: number;
};

export type AgentPlanStep = {
  label: string;
  state: "done" | "active" | "pending";
};

export type AgentTouchedFile = {
  path: string;
  added: number;
  removed: number;
  /** This agent holds the write claim on the path — nobody else can edit it. */
  claimed: boolean;
};

export type AgentLogLine = {
  id: string;
  at: number;
  kind: "action" | "steer" | "result" | "warn";
  text: string;
  /** Set when a human steered, so attribution is visible in the stream. */
  authorId?: string;
};

export type MissionControlAgent = {
  id: string;
  /** What this agent was asked to do, in the owner's words. */
  title: string;
  branch: string;
  provider: "claude" | "codex";
  model: string;
  phase: AgentPhase;
  /** The single line describing what it is doing this second. */
  activity: string;
  ownerId: string;
  /** Members currently watching or steering this agent. */
  watcherIds: string[];
  startedAt: number;
  tokens: number;
  files: AgentTouchedFile[];
  plan: AgentPlanStep[];
  log: AgentLogLine[];
  /** Set when another agent holds a claim this one wants. */
  blockedBy?: { agentId: string; path: string };
};

export type MissionControlSnapshot = {
  workspace: string;
  repository: string;
  members: MissionControlMember[];
  agents: MissionControlAgent[];
  maxAgents: number;
};

export const AGENT_PHASE_LABEL: Record<AgentPhase, string> = {
  planning: "Planning",
  editing: "Editing",
  testing: "Running tests",
  reviewing: "Reviewing",
  blocked: "Blocked",
  waiting: "Waiting for you",
  done: "Ready to merge",
};

export function memberById(
  snapshot: MissionControlSnapshot,
  id: string | undefined,
): MissionControlMember | undefined {
  return snapshot.members.find((member) => member.id === id);
}

export function agentDiffTotals(agent: MissionControlAgent) {
  return agent.files.reduce(
    (totals, file) => ({
      added: totals.added + file.added,
      removed: totals.removed + file.removed,
    }),
    { added: 0, removed: 0 },
  );
}

/** `mm:ss` since the agent started, for a live-ticking runtime readout. */
export function elapsedLabel(startedAt: number, now: number) {
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

export function relativeLabel(at: number, now: number) {
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  return `${Math.floor(seconds / 60)}m ago`;
}
