import type { AgentSession } from "@/components/agent-panel";
import type { CollaborationUser } from "@/lib/collaboration-client";
import type { WorkspaceShareMember } from "@/components/share-dialog";

export const TEAM_STATS_VM_QUOTA = 2_000;

const ACTIVE_AGENT_STATUSES = new Set(["queued", "running", "waiting"]);

export type CountBucket = {
  key: string;
  label: string;
  count: number;
  share: number;
};

export type TeamStatsSnapshot = {
  peopleOnline: number;
  memberCount: number;
  activeAgents: number;
  sessionCount: number;
  turnCount: number;
  failedSessions: number;
  openWorktrees: number;
  mergedWorktrees: number;
  discardedWorktrees: number;
  reviewedSessions: number;
  openClaims: number;
  providers: CountBucket[];
  models: CountBucket[];
  statuses: CountBucket[];
  recentSessions: Array<{
    id: string;
    name: string;
    model: string;
    provider: string;
    status: string;
    worktreeStatus: string;
    turnCount: number;
    lastPrompt: string | null;
    lastError: string | null;
    hasReview: boolean;
  }>;
  people: Array<{
    id: string;
    name: string;
    roleLabel: string;
    detail: string;
    online: boolean;
    isYou: boolean;
  }>;
  coordination: Array<{
    id: string;
    sessionName: string;
    pathGlob: string;
    intent: string;
    status: string;
  }>;
};

function titleCase(value: string) {
  return value
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function providerLabel(provider: string | undefined) {
  switch (provider) {
    case "openai":
      return "Codex";
    case "anthropic":
      return "Claude";
    case "cursor":
      return "Cursor";
    case "bedrock":
      return "Bedrock";
    case "azure_foundry":
      return "Azure";
    default:
      return provider ? titleCase(provider) : "Unknown";
  }
}

function accessRoleLabel(role: WorkspaceShareMember["accessRole"] | "owner") {
  switch (role) {
    case "owner":
      return "Owner";
    case "co_steer":
      return "Co-steer";
    case "reviewer":
      return "Reviewer";
    case "viewer":
      return "Viewer";
    default:
      return titleCase(role);
  }
}

function toBuckets(
  counts: Map<string, number>,
  total: number,
  labelFor: (key: string) => string = (key) => key,
): CountBucket[] {
  return [...counts.entries()]
    .map(([key, count]) => ({
      key,
      label: labelFor(key),
      count,
      share: total > 0 ? count / total : 0,
    }))
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));
}

function collaboratorDisplayName(member: CollaborationUser) {
  return member.name ?? member.login;
}

function memberDisplayName(member: WorkspaceShareMember) {
  return member.name ?? member.login;
}

/**
 * Derive workspace overview metrics from sessions, presence, and membership.
 */
export function buildTeamStatsSnapshot({
  sessions,
  collaborators,
  members,
  currentUser,
  peopleOnline,
}: {
  sessions: AgentSession[];
  collaborators: CollaborationUser[];
  members: WorkspaceShareMember[];
  currentUser: { id: string; name?: string | null; login?: string };
  peopleOnline: number;
}): TeamStatsSnapshot {
  const providerCounts = new Map<string, number>();
  const modelCounts = new Map<string, number>();
  const statusCounts = new Map<string, number>();
  let turnCount = 0;
  let failedSessions = 0;
  let openWorktrees = 0;
  let mergedWorktrees = 0;
  let discardedWorktrees = 0;
  let reviewedSessions = 0;
  let openClaims = 0;
  const coordination: TeamStatsSnapshot["coordination"] = [];

  for (const session of sessions) {
    const provider = session.provider ?? "unknown";
    providerCounts.set(provider, (providerCounts.get(provider) ?? 0) + 1);
    modelCounts.set(session.model, (modelCounts.get(session.model) ?? 0) + 1);
    statusCounts.set(session.status, (statusCounts.get(session.status) ?? 0) + 1);
    turnCount += session.turns.length;
    if (session.status === "failed" || session.lastError) failedSessions += 1;
    if (session.worktreeStatus === "active" || session.worktreeStatus === "frozen") {
      openWorktrees += 1;
    } else if (session.worktreeStatus === "merged") {
      mergedWorktrees += 1;
    } else if (session.worktreeStatus === "discarded") {
      discardedWorktrees += 1;
    }
    if (session.reviewedAt || session.reviewDiffDigest) reviewedSessions += 1;
    for (const claim of session.claims) {
      if (claim.status === "active" || claim.status === "open") {
        openClaims += 1;
        coordination.push({
          id: claim.id,
          sessionName: session.name,
          pathGlob: claim.pathGlob,
          intent: claim.intent,
          status: claim.status,
        });
      }
    }
  }

  const onlineById = new Map(
    collaborators.map((member) => [member.id, member] as const),
  );

  const peopleFromMembers = members.map((member) => {
    const online = onlineById.get(member.userId);
    const isYou = member.userId === currentUser.id;
    return {
      id: member.userId,
      name: isYou
        ? (currentUser.name ?? currentUser.login ?? memberDisplayName(member))
        : memberDisplayName(member),
      roleLabel: accessRoleLabel(
        member.accessRole === "owner" || member.role === "owner"
          ? "owner"
          : member.accessRole,
      ),
      detail: online?.activePath
        ? `Editing ${online.activePath}`
        : online
          ? "Online in workspace"
          : "Offline",
      online: Boolean(online) || isYou,
      isYou,
    };
  });

  const memberIds = new Set(members.map((member) => member.userId));
  const guestPresence = collaborators
    .filter((member) => !memberIds.has(member.id) && member.id !== currentUser.id)
    .map((member) => ({
      id: member.id,
      name: collaboratorDisplayName(member),
      roleLabel: "Guest",
      detail: member.activePath
        ? `Editing ${member.activePath}`
        : "Online in workspace",
      online: true,
      isYou: false,
    }));

  const people = [...peopleFromMembers, ...guestPresence].sort((left, right) => {
    if (left.online !== right.online) return left.online ? -1 : 1;
    if (left.isYou !== right.isYou) return left.isYou ? -1 : 1;
    return left.name.localeCompare(right.name);
  });

  const recentSessions = [...sessions]
    .reverse()
    .slice(0, 8)
    .map((session) => {
      const lastTurn = session.turns.at(-1);
      return {
        id: session.id,
        name: session.name,
        model: session.model,
        provider: providerLabel(session.provider),
        status: session.status,
        worktreeStatus: session.worktreeStatus,
        turnCount: session.turns.length,
        lastPrompt: lastTurn?.prompt?.trim() || null,
        lastError: session.lastError,
        hasReview: Boolean(session.reviewedAt || session.reviewDiffDigest),
      };
    });

  return {
    peopleOnline,
    memberCount: members.length,
    activeAgents: sessions.filter((session) =>
      ACTIVE_AGENT_STATUSES.has(session.status),
    ).length,
    sessionCount: sessions.length,
    turnCount,
    failedSessions,
    openWorktrees,
    mergedWorktrees,
    discardedWorktrees,
    reviewedSessions,
    openClaims,
    providers: toBuckets(providerCounts, sessions.length, providerLabel),
    models: toBuckets(modelCounts, sessions.length).slice(0, 6),
    statuses: toBuckets(statusCounts, sessions.length, titleCase),
    recentSessions,
    people,
    coordination: coordination.slice(0, 8),
  };
}

export function formatPercent(share: number) {
  return `${Math.round(share * 100)}%`;
}
