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

import { claimPatternsOverlap } from "./claim-patterns";

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

/** Two or more live agents holding claims that cover the same files. This is
 *  the real collision, and the only thing the panel is entitled to call one.
 *
 *  Not one path: a claim is an exact path *or* a `dir/**` glob, and the write
 *  path marks `apps/web/**` and `apps/web/lib/auth.ts` contested against each
 *  other. Keying a contest on a single path string would have hidden exactly
 *  those. `holders` says who holds what, so the reader can name both sides. */
export type CoordinationContest = {
  /** Every distinct pattern in the colliding group, in claim order. */
  paths: string[];
  holders: {
    sessionId: string;
    agentLabel: string;
    /** The patterns this session holds inside this contest. */
    paths: string[];
  }[];
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

/**
 * Group live claims into collisions, using the same `claimPatternsOverlap`
 * predicate the write path uses to decide a claim is contested — so a pair the
 * database recorded as contested can never read as uncontested here.
 *
 * Claims are only joined across *different* sessions: one session holding a
 * path twice is not colliding with anybody. The grouping is transitive, so
 * `apps/**` held by A pulls in both `apps/web/a.ts` (B) and `apps/web/b.ts`
 * (C), which do not overlap each other but are all one collision around A.
 */
export function toCoordinationContests(
  claims: CoordinationClaim[],
): CoordinationContest[] {
  const group = claims.map((_, index) => index);
  const rootOf = (index: number): number => {
    let current = index;
    while (group[current] !== current) {
      group[current] = group[group[current]!]!;
      current = group[current]!;
    }
    return current;
  };
  for (let left = 0; left < claims.length; left += 1) {
    for (let right = left + 1; right < claims.length; right += 1) {
      const one = claims[left]!;
      const other = claims[right]!;
      if (one.sessionId === other.sessionId) continue;
      if (!claimPatternsOverlap(one.path, other.path)) continue;
      const rootLeft = rootOf(left);
      const rootRight = rootOf(right);
      if (rootLeft !== rootRight) group[rootRight] = rootLeft;
    }
  }

  const grouped = new Map<number, CoordinationClaim[]>();
  for (let index = 0; index < claims.length; index += 1) {
    const root = rootOf(index);
    grouped.set(root, [...(grouped.get(root) ?? []), claims[index]!]);
  }

  const contests: CoordinationContest[] = [];
  for (const members of grouped.values()) {
    const holders = new Map<string, { agentLabel: string; paths: string[] }>();
    for (const claim of members) {
      const holder = holders.get(claim.sessionId) ?? {
        agentLabel: claim.agentLabel,
        paths: [],
      };
      if (!holder.paths.includes(claim.path)) holder.paths.push(claim.path);
      holders.set(claim.sessionId, holder);
    }
    // A single session's claims are a group of one holder — not a collision.
    if (holders.size < 2) continue;
    const paths: string[] = [];
    for (const claim of members) {
      if (!paths.includes(claim.path)) paths.push(claim.path);
    }
    contests.push({
      paths,
      holders: [...holders].map(([sessionId, holder]) => ({
        sessionId,
        ...holder,
      })),
    });
  }
  return contests;
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

  const contests = toCoordinationContests(claims);

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
