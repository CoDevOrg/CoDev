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
  canReview: boolean;
};

export type ReviewCheckpoint = {
  sessionId: string;
  slot: 1 | 2 | 3 | null;
  assignment: string;
  worktreeId: string;
  worktree: string;
  worktreeStatus: string;
  prepared: boolean;
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
};

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
      return {
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
        baseRevision: session.reviewBaseSha,
        headRevision: session.reviewHeadSha,
        diffDigest: formatDiffDigest(session.reviewDiffDigest),
        summary: parsed?.summary ?? null,
        additions: parsed?.additions ?? EMPTY_REVIEW_DIFF_SUMMARY.additions,
        deletions: parsed?.deletions ?? EMPTY_REVIEW_DIFF_SUMMARY.deletions,
        paths: parsed?.paths ?? [],
      };
    });
}

export function toReviewSnapshot(input: {
  viewer: ReviewViewer;
  sessions: ReviewSession[];
  diffs?: Record<string, string>;
  now?: Date;
}): ReviewSnapshot {
  const board = toWorkboardSlots(input.sessions, input.now);
  return {
    viewer: input.viewer,
    slots: board.slots,
    checkpoints: toReviewCheckpoints(
      input.sessions,
      board.slots,
      input.diffs ?? {},
    ),
  };
}

export function snapshotOmitsRawDiff(snapshot: ReviewSnapshot) {
  return !JSON.stringify(snapshot).includes("diff --git ");
}
