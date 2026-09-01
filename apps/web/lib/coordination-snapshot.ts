/**
 * The workspace's live coordination state, shaped for display.
 *
 * Mission Control used to infer "blocked on a file claim" from a regular
 * expression over an agent's free-text status, and then tell the user "CoDev is
 * holding the write so two agents cannot collide" on the strength of that string
 * match. The claim rows are real — every agent CLI writes them through the
 * coordination MCP — so the panel reads them instead of guessing.
 *
 * Pure projection, no database: the server module hands it rows, tests hand it
 * fixtures.
 */

export type CoordinationClaimSource = {
  id: string;
  sessionId: string;
  pathGlob: string;
  intent: string;
  status: string;
  expiresAt: Date | string;
};

export type CoordinationSessionSource = {
  id: string;
  name: string | null;
  provider: string | null;
  kind: string;
  worktreeId: string | null;
  /** The worktree directory name, which for a CLI agent is its branch. */
  worktreeName: string | null;
  ownerName: string;
};

export type CoordinationOverlapSource = {
  id: string;
  leftSessionId: string;
  rightSessionId: string;
  kind: string;
  score: number;
  rationale: string;
};

export type CoordinationClaim = {
  id: string;
  sessionId: string;
  worktreeId: string | null;
  /** Branch for a CLI agent, worktree name for a managed one. Null when the
   *  session has no worktree row yet. */
  branch: string | null;
  agentLabel: string;
  ownerName: string;
  path: string;
  intent: string;
  status: "active" | "contested";
  expiresAt: string;
};

export type CoordinationOverlap = {
  id: string;
  sessionIds: [string, string];
  branches: (string | null)[];
  agentLabels: string[];
  kind: string;
  score: number;
  rationale: string;
};

/** One path more than one live agent is holding. This is the real collision,
 *  and the only thing the panel is entitled to call one. */
export type CoordinationContest = {
  path: string;
  sessionIds: string[];
  agentLabels: string[];
};

export type CoordinationSnapshot = {
  claims: CoordinationClaim[];
  overlaps: CoordinationOverlap[];
  contests: CoordinationContest[];
};

export const EMPTY_COORDINATION_SNAPSHOT: CoordinationSnapshot = {
  claims: [],
  overlaps: [],
  contests: [],
};

function isoDate(value: Date | string): string {
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

/**
 * How one agent is named in the panel. A CLI session's own name is already the
 * descriptive form the IDE gave it (`claude · codev/fix-auth-1a2b`); a managed
 * session's name is its assignment. Provider is the fallback so a row is never
 * nameless.
 */
export function coordinationAgentLabel(
  session: Pick<CoordinationSessionSource, "name" | "provider"> | undefined,
): string {
  const name = session?.name?.trim();
  if (name) return name;
  const provider = session?.provider?.trim();
  return provider ? `${provider} agent` : "An agent";
}

export function toCoordinationSnapshot(input: {
  claims: CoordinationClaimSource[];
  sessions: CoordinationSessionSource[];
  overlaps: CoordinationOverlapSource[];
}): CoordinationSnapshot {
  const bySession = new Map(
    input.sessions.map((session) => [session.id, session]),
  );

  const claims: CoordinationClaim[] = input.claims
    // Released claims are history, not a hold on anything.
    .filter(
      (claim) => claim.status === "active" || claim.status === "contested",
    )
    .map((claim) => {
      const session = bySession.get(claim.sessionId);
      return {
        id: claim.id,
        sessionId: claim.sessionId,
        worktreeId: session?.worktreeId ?? null,
        branch: session?.worktreeName ?? null,
        agentLabel: coordinationAgentLabel(session),
        ownerName: session?.ownerName ?? "Someone",
        path: claim.pathGlob,
        intent: claim.intent,
        status: claim.status === "contested" ? "contested" : "active",
        expiresAt: isoDate(claim.expiresAt),
      };
    });

  // A contest is two or more *different* sessions holding the same path. One
  // session with two claims on a path is not colliding with anybody.
  const byPath = new Map<string, CoordinationClaim[]>();
  for (const claim of claims) {
    byPath.set(claim.path, [...(byPath.get(claim.path) ?? []), claim]);
  }
  const contests: CoordinationContest[] = [];
  for (const [path, group] of byPath) {
    const sessionIds = [...new Set(group.map((claim) => claim.sessionId))];
    if (sessionIds.length < 2) continue;
    contests.push({
      path,
      sessionIds,
      agentLabels: sessionIds.map((sessionId) =>
        coordinationAgentLabel(bySession.get(sessionId)),
      ),
    });
  }

  const overlaps: CoordinationOverlap[] = input.overlaps.map((overlap) => ({
    id: overlap.id,
    sessionIds: [overlap.leftSessionId, overlap.rightSessionId],
    branches: [overlap.leftSessionId, overlap.rightSessionId].map(
      (sessionId) => bySession.get(sessionId)?.worktreeName ?? null,
    ),
    agentLabels: [overlap.leftSessionId, overlap.rightSessionId].map(
      (sessionId) => coordinationAgentLabel(bySession.get(sessionId)),
    ),
    kind: overlap.kind,
    score: overlap.score,
    rationale: overlap.rationale,
  }));

  return { claims, overlaps, contests };
}
