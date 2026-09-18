import {
  toWorkboardSlots,
  type WorkboardSession,
  type WorkboardSlot,
  type WorkboardViewer,
} from "./workboard-view";

export const DEFAULT_CLAIM_PATH = "README.md";
export const DEFAULT_CLAIM_INTENT = "Prepare an exact write claim";
export const DEFAULT_CLAIM_REVISION = "HEAD";
export const CONTESTED_OVERLAP_TITLE =
  "Contested overlap · no silent overwrite";
export const CANCELLED_CLAIM_NOTICE = "Overlapping claim cancelled";

export function reassignedClaimNotice(slot: 1 | 2 | 3) {
  return `Claim reassigned to Agent slot ${slot}`;
}

export type PathClaimSource = {
  id: string;
  sessionId: string;
  pathGlob: string;
  intent: string;
  revision: string;
  status: string;
  expiresAt: Date | string;
  createdAt?: Date | string;
};

export type PathClaimRecord = {
  id: string;
  sessionId: string;
  slot: 1 | 2 | 3 | null;
  assignment: string;
  owner: string;
  worktreeId: string | null;
  worktree: string;
  path: string;
  intent: string;
  revision: string;
  status: "active" | "contested" | "released";
  displayStatus: "Active" | "Contested" | "Released" | "Cancelled";
  expiresAt: string;
};

export type PathClaimGroup = {
  path: string;
  contested: boolean;
  warningTitle: string | null;
  warningDetail: string | null;
  claims: PathClaimRecord[];
  keepClaimId: string | null;
  overlappingClaimId: string | null;
  reassignSlot: 1 | 2 | 3 | null;
  reassignClaimId: string | null;
};

export type PathClaimsSnapshot = {
  viewer: WorkboardViewer;
  slots: WorkboardSlot[];
  groups: PathClaimGroup[];
  claims: PathClaimRecord[];
  defaultPath: string;
  defaultRevision: string;
  notice: string | null;
};

function isoDate(value: Date | string) {
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

export function displayClaimStatus(
  claim: Pick<PathClaimRecord, "id" | "status">,
  groupClaims: Array<Pick<PathClaimRecord, "id" | "status">>,
): PathClaimRecord["displayStatus"] {
  if (claim.status === "contested") return "Contested";
  if (claim.status === "active") return "Active";
  const oldestId = groupClaims[0]?.id;
  const hasActive = groupClaims.some(
    (candidate) => candidate.status === "active",
  );
  if (hasActive && claim.id !== oldestId) return "Cancelled";
  return "Released";
}

export function toPathClaimRecords(
  claims: PathClaimSource[],
  slots: WorkboardSlot[],
): PathClaimRecord[] {
  const bySession = new Map(
    slots
      .filter((slot) => slot.sessionId)
      .map((slot) => [slot.sessionId as string, slot]),
  );
  return claims
    .filter(
      (claim) =>
        claim.status === "active" ||
        claim.status === "contested" ||
        claim.status === "released",
    )
    .map((claim) => {
      const slot = bySession.get(claim.sessionId);
      return {
        id: claim.id,
        sessionId: claim.sessionId,
        slot: slot?.slot ?? null,
        assignment: slot?.assignment ?? "Managed proposal",
        owner: slot?.owner ?? "Unassigned",
        worktreeId: slot?.worktreeId ?? null,
        worktree: slot?.worktree ?? "No worktree",
        path: claim.pathGlob,
        intent: claim.intent,
        revision: claim.revision,
        status: claim.status as PathClaimRecord["status"],
        displayStatus: "Active",
        expiresAt: isoDate(claim.expiresAt),
      };
    });
}

export function contestedOverlapDetail(
  path: string,
  overlappingSlot: 1 | 2 | 3 | null,
  keepSlot: 1 | 2 | 3 | null,
) {
  const requester = overlappingSlot
    ? `Agent slot ${overlappingSlot}`
    : "Another agent";
  const owner = keepSlot ? `Agent slot ${keepSlot}` : "another agent";
  return `${requester} requested ${path}, which is already claimed by ${owner}. Reassign or cancel before either agent writes.`;
}

export function toPathClaimGroups(
  records: PathClaimRecord[],
): PathClaimGroup[] {
  const byPath = new Map<string, PathClaimRecord[]>();
  for (const record of records) {
    const list = byPath.get(record.path) ?? [];
    list.push(record);
    byPath.set(record.path, list);
  }
  return [...byPath.entries()].map(([path, grouped]) => {
    const claims = grouped.map((claim) => ({
      ...claim,
      displayStatus: displayClaimStatus(claim, grouped),
    }));
    const live = claims.filter(
      (claim) => claim.status === "active" || claim.status === "contested",
    );
    const contested =
      live.some((claim) => claim.status === "contested") || live.length > 1;
    const keep = live[0] ?? null;
    const overlapping = live.find((claim) => claim.id !== keep?.id) ?? null;
    return {
      path,
      contested,
      warningTitle: contested ? CONTESTED_OVERLAP_TITLE : null,
      warningDetail:
        contested && keep
          ? contestedOverlapDetail(path, overlapping?.slot ?? null, keep.slot)
          : null,
      claims,
      keepClaimId: keep?.id ?? null,
      overlappingClaimId: overlapping?.id ?? null,
      reassignSlot: overlapping?.slot ?? null,
      reassignClaimId: overlapping?.id ?? null,
    };
  });
}

export function claimGroupForPath(
  groups: PathClaimGroup[],
  relativePath: string,
) {
  return (
    groups.find((group) => {
      if (group.path === relativePath) return true;
      if (group.path.endsWith("/**")) {
        const directory = group.path.slice(0, -3);
        return (
          relativePath === directory || relativePath.startsWith(`${directory}/`)
        );
      }
      return false;
    }) ?? null
  );
}

export function toPathClaimsSnapshot(input: {
  viewer: WorkboardViewer;
  sessions: WorkboardSession[];
  claims: PathClaimSource[];
  defaultRevision?: string;
  notice?: string | null;
  now?: Date;
}): PathClaimsSnapshot {
  const board = toWorkboardSlots(input.sessions, input.now);
  const records = toPathClaimRecords(input.claims, board.slots);
  const groups = toPathClaimGroups(records);
  return {
    viewer: input.viewer,
    slots: board.slots,
    groups,
    claims: groups.flatMap((group) => group.claims),
    defaultPath: DEFAULT_CLAIM_PATH,
    defaultRevision: input.defaultRevision?.trim() || DEFAULT_CLAIM_REVISION,
    notice: input.notice ?? null,
  };
}
