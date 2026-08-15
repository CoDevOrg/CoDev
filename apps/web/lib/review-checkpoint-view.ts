import {
  EMPTY_REVIEW_DIFF_SUMMARY,
  summarizeReviewDiff,
  type ReviewDiffPath,
} from "./review-diff-view";
import {
  toWorkboardSlots,
  type WorkboardSession,
  type WorkboardSlot,
} from "./workboard-view";

export type ReviewSession = WorkboardSession & {
  reviewBaseSha: string | null;
  reviewHeadSha: string | null;
  reviewDiffDigest: string | null;
};

export type ReviewViewer = {
  id: string;
  name: string;
  role: "Maintainer" | "Collaborator" | "Viewer";
  canReview: boolean;
  canMerge: boolean;
};

export type ReviewApprovalState = "current" | "stale" | "integrated";

export type ReviewApproval = {
  state: ReviewApprovalState;
  blocked: boolean;
  mergeStarted: boolean;
};

export type ReviewIntegration = {
  actor: string;
  role: ReviewViewer["role"];
  event: "agent.review_merged";
  baseRevision: string;
  headRevision: string;
  mergedHeadSha: string;
};

export type ReviewCheckpoint = {
  sessionId: string;
  slot: 1 | 2 | 3 | null;
  assignment: string;
  worktreeId: string;
  worktree: string;
  worktreeStatus: string;
  prepared: boolean;
  stale: boolean;
  baseRevision: string | null;
  headRevision: string | null;
  diffDigest: string | null;
  summary: string | null;
  additions: number;
  deletions: number;
  paths: ReviewDiffPath[];
};

export type ReviewSnapshot = {
  viewer: ReviewViewer;
  slots: WorkboardSlot[];
  checkpoints: ReviewCheckpoint[];
  integrationHeadRevision: string | null;
  approval: ReviewApproval;
  integration: ReviewIntegration | null;
};

export function reviewRoleLabel(
  role: "owner" | "co_steer" | "reviewer" | "viewer" | null | undefined,
): ReviewViewer["role"] {
  if (role === "owner") return "Maintainer";
  if (role === "viewer") return "Viewer";
  return "Collaborator";
}

export function toReviewApproval(input: {
  integration?: ReviewIntegration | null;
  stale?: boolean;
}): ReviewApproval {
  if (input.integration) {
    return { state: "integrated", blocked: false, mergeStarted: false };
  }
  if (input.stale) {
    return { state: "stale", blocked: true, mergeStarted: false };
  }
  return { state: "current", blocked: false, mergeStarted: false };
}

export function isStaleReviewCheckpoint(
  checkpoint: Pick<ReviewCheckpoint, "prepared" | "baseRevision">,
  integrationHeadRevision: string | null,
) {
  return Boolean(
    checkpoint.prepared &&
    checkpoint.baseRevision &&
    integrationHeadRevision &&
    checkpoint.baseRevision !== integrationHeadRevision,
  );
}

export function formatDiffDigest(digest: string | null) {
  if (!digest) return null;
  return digest.startsWith("sha256:") ? digest : `sha256:${digest}`;
}

export function selectReviewCheckpoint(
  checkpoints: ReviewCheckpoint[],
  worktreeId: string | null,
) {
  if (worktreeId) {
    const matched = checkpoints.find(
      (checkpoint) => checkpoint.worktreeId === worktreeId,
    );
    if (matched) return matched;
  }
  return null;
}

export function toReviewCheckpoints(
  sessions: ReviewSession[],
  slots: WorkboardSlot[],
  diffs: Record<string, string> = {},
  integrationHeadRevision: string | null = null,
): ReviewCheckpoint[] {
  const bySession = new Map(
    slots
      .filter((slot) => slot.sessionId)
      .map((slot) => [slot.sessionId as string, slot]),
  );
  return sessions
    .filter(
      (session) =>
        session.worktreeStatus === "active" ||
        session.worktreeStatus === "frozen",
    )
    .map((session) => {
      const slot = bySession.get(session.id);
      const prepared = Boolean(
        session.reviewHeadSha &&
        session.reviewBaseSha &&
        session.reviewDiffDigest,
      );
      const diff = Object.hasOwn(diffs, session.worktreeId)
        ? diffs[session.worktreeId]
        : undefined;
      const parsed =
        typeof diff === "string" ? summarizeReviewDiff(diff) : null;
      const checkpoint = {
        sessionId: session.id,
        slot: slot?.slot ?? null,
        assignment:
          slot?.assignment ?? session.issueTitle?.trim() ?? session.name,
        worktreeId: session.worktreeId,
        worktree: slot?.worktree ?? session.worktreeName,
        worktreeStatus:
          session.worktreeStatus === "frozen"
            ? "Frozen"
            : (slot?.status ?? "Active"),
        prepared,
        stale: false,
        baseRevision: session.reviewBaseSha,
        headRevision: session.reviewHeadSha,
        diffDigest: formatDiffDigest(session.reviewDiffDigest),
        summary: parsed?.summary ?? null,
        additions: parsed?.additions ?? EMPTY_REVIEW_DIFF_SUMMARY.additions,
        deletions: parsed?.deletions ?? EMPTY_REVIEW_DIFF_SUMMARY.deletions,
        paths: parsed?.paths ?? [],
      };
      return {
        ...checkpoint,
        stale: isStaleReviewCheckpoint(checkpoint, integrationHeadRevision),
      };
    });
}

export function toReviewSnapshot(input: {
  viewer: ReviewViewer;
  sessions: ReviewSession[];
  diffs?: Record<string, string>;
  integrationHeadRevision?: string | null;
  integration?: ReviewIntegration | null;
  now?: Date;
}): ReviewSnapshot {
  const board = toWorkboardSlots(input.sessions, input.now);
  const integrationHeadRevision = input.integrationHeadRevision ?? null;
  const checkpoints = toReviewCheckpoints(
    input.sessions,
    board.slots,
    input.diffs ?? {},
    integrationHeadRevision,
  );
  const integration = input.integration ?? null;
  return {
    viewer: {
      ...input.viewer,
      role: input.viewer.role ?? "Collaborator",
      canMerge: Boolean(input.viewer.canMerge),
    },
    slots: board.slots,
    checkpoints,
    integrationHeadRevision,
    approval: toReviewApproval({
      integration,
      stale: checkpoints.some((checkpoint) => checkpoint.stale),
    }),
    integration,
  };
}

export function snapshotOmitsRawDiff(snapshot: ReviewSnapshot) {
  return !JSON.stringify(snapshot).includes("diff --git ");
}
