import { deriveAgentSessionName } from "./agent-session-name";

/**
 * A fresh chat on an agent that is already running.
 *
 * When a thread runs long enough that the model's context is the bottleneck,
 * the member wants a clean conversation without giving up the branch, the
 * checkout, or the work already on disk. That is a new `agentSessions` row
 * pointed at the *same* worktree, which is why it costs no capacity slot.
 */
const MAX_SESSION_NAME = 32;

export function deriveFreshChatSessionName(
  sourceName: string,
  existingNames: string[] = [],
): string {
  const base = deriveAgentSessionName(sourceName.trim() || "Agent", "Agent")
    // Strip a trailing counter so the third chat reads "Name 3", not "Name 2 2".
    .replace(/\s+\d+$/, "")
    .trim();
  const taken = new Set(existingNames.map((name) => name.trim()));
  for (let counter = 2; counter < 100; counter += 1) {
    const suffix = ` ${counter}`;
    const room = MAX_SESSION_NAME - suffix.length;
    const candidate = `${base.slice(0, room).trim()}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
  return deriveAgentSessionName(base, "Agent");
}

/**
 * A worktree must still be live to host another conversation: a discarded
 * checkout has no files for the new chat to work on.
 */
export function canStartFreshChat(worktreeStatus: string): boolean {
  return worktreeStatus === "active" || worktreeStatus === "frozen";
}
