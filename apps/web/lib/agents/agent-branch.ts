import { deriveAgentSessionName } from "./agent-session-name";

export type BranchableTurn = {
  id: string;
  prompt: string;
  attachments?: unknown;
  status: string;
  output: string | null;
  lastError: string | null;
  createdAt?: string | Date | null;
};

/**
 * Returns source turns through `fromTurnId` inclusive, for seeding a branched session.
 */
export function selectTurnsThroughReply<T extends BranchableTurn>(
  turns: T[],
  fromTurnId: string,
): T[] {
  const index = turns.findIndex((turn) => turn.id === fromTurnId);
  if (index < 0) {
    throw new Error("That agent reply was not found in this session.");
  }
  return turns.slice(0, index + 1);
}

export function deriveBranchSessionName(sourceName: string) {
  const cleaned = sourceName.trim() || "session";
  return deriveAgentSessionName(`Branch ${cleaned}`, "Branch");
}

export function branchWorktreeName(sessionName: string, suffix: string) {
  const slug = sessionName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
  return `agent-${slug || "branch"}-${suffix}`;
}
