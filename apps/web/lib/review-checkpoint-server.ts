import "server-only";

import { identifierSchema } from "@codev/contracts";
import { z } from "zod";

import { getWorkspaceAccess } from "./access";
import { prepareAgentReview } from "./agent-review";
import { listAgentSessions } from "./agent-runtime";
import { reviewSandboxWorktree } from "./orchestrator";
import {
  toReviewSnapshot,
  type ReviewSession,
  type ReviewSnapshot,
  type ReviewViewer,
} from "./review-checkpoint-view";
import { displayMemberName } from "./shared-session-view";
import type { WorkboardSession } from "./workboard-view";

const prepareReviewSchema = z.object({
  sessionId: identifierSchema,
});

function asWorkboardSession(
  session: Awaited<ReturnType<typeof listAgentSessions>>[number],
): WorkboardSession {
  return {
    id: session.id,
    name: session.name,
    provider: session.provider,
    status: session.status,
    worktreeId: session.worktreeId,
    worktreeName: session.worktreeName,
    worktreeStatus: session.worktreeStatus,
    ownerName: session.ownerName,
    ownerLogin: session.ownerLogin,
    issueTitle: session.issueTitle,
    createdAt: session.createdAt,
    turns: session.turns.map((turn) => ({
      prompt: turn.prompt,
      status: turn.status,
    })),
  };
}

function asReviewSession(
  session: Awaited<ReturnType<typeof listAgentSessions>>[number],
): ReviewSession {
  return {
    ...asWorkboardSession(session),
    reviewBaseSha: session.reviewBaseSha,
    reviewHeadSha: session.reviewHeadSha,
    reviewDiffDigest: session.reviewDiffDigest,
  };
}

async function viewerFor(
  workspaceId: string,
  user: { id: string; name?: string | null; githubLogin?: string },
): Promise<ReviewViewer> {
  const access = await getWorkspaceAccess(workspaceId, user.id);
  return {
    id: user.id,
    name: displayMemberName(user.name, user.githubLogin),
    canReview: Boolean(access?.permissions.review),
  };
}

async function loadReviewDiffs(workspaceId: string, sessions: ReviewSession[]) {
  const prepared = sessions.filter(
    (session) => session.reviewBaseSha && session.reviewHeadSha,
  );
  const entries = await Promise.all(
    prepared.map(async (session) => {
      try {
        const review = await reviewSandboxWorktree(
          workspaceId,
          session.worktreeId,
          session.reviewBaseSha as string,
        );
        return [session.worktreeId, review.diff] as const;
      } catch {
        return null;
      }
    }),
  );
  return Object.fromEntries(
    entries.filter(
      (entry): entry is readonly [string, string] => entry !== null,
    ),
  );
}

export async function loadReviewSnapshot(
  workspaceId: string,
  user: { id: string; name?: string | null; githubLogin?: string },
  diffOverrides: Record<string, string> = {},
): Promise<ReviewSnapshot> {
  const [viewer, listed] = await Promise.all([
    viewerFor(workspaceId, user),
    listAgentSessions(workspaceId),
  ]);
  const sessions = listed.map(asReviewSession);
  const diffs = {
    ...(await loadReviewDiffs(workspaceId, sessions)),
    ...diffOverrides,
  };
  return toReviewSnapshot({ viewer, sessions, diffs });
}

export async function prepareWorkspaceReview(
  workspaceId: string,
  user: { id: string; name?: string | null; githubLogin?: string },
  rawInput: unknown,
) {
  const { sessionId } = prepareReviewSchema.parse(rawInput);
  const review = await prepareAgentReview(workspaceId, sessionId, user.id);
  const listed = await listAgentSessions(workspaceId);
  const target = listed.find((session) => session.id === sessionId);
  const diffOverrides = target ? { [target.worktreeId]: review.diff } : {};
  return loadReviewSnapshot(workspaceId, user, diffOverrides);
}
