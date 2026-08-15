import "server-only";

import { identifierSchema } from "@codev/contracts";
import { z } from "zod";

import { and, eq } from "drizzle-orm";

import { schema } from "@codev/db";

import { getWorkspaceAccess } from "./access";
import {
  advanceIntegrationHead,
  mergeAgentReview,
  prepareAgentReview,
  ReviewActionError,
} from "./agent-review";
import { listAgentSessions } from "./agent-runtime";
import { listWorkspaceEvents } from "./audit";
import { getDatabase } from "./database";
import {
  executeInSandbox,
  OrchestratorError,
  reviewSandboxWorktree,
} from "./orchestrator";
import {
  reviewRoleLabel,
  toReviewSnapshot,
  type ReviewIntegration,
  type ReviewSession,
  type ReviewSnapshot,
  type ReviewViewer,
} from "./review-checkpoint-view";
import { displayMemberName } from "./shared-session-view";
import type { WorkboardSession } from "./workboard-view";

const reviewActionSchema = z.object({
  action: z.enum(["prepare", "advance", "merge"]).default("prepare"),
  sessionId: identifierSchema.optional(),
});

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
    role: reviewRoleLabel(access?.role),
    canReview: Boolean(access?.permissions.review),
    canMerge: Boolean(access?.permissions.merge),
  };
}

async function loadIntegrationHeadRevision(workspaceId: string) {
  const [integration] = await getDatabase()
    .select({ headSha: schema.worktrees.headSha })
    .from(schema.worktrees)
    .where(
      and(
        eq(schema.worktrees.workspaceId, workspaceId),
        eq(schema.worktrees.kind, "integration"),
      ),
    )
    .limit(1);
  return integration?.headSha ?? null;
}

function integrationFromPayload(
  viewer: ReviewViewer,
  payload: Record<string, unknown> | null | undefined,
): ReviewIntegration | null {
  if (!payload) return null;
  const baseRevision =
    typeof payload.reviewBaseSha === "string" ? payload.reviewBaseSha : null;
  const headRevision =
    typeof payload.reviewHeadSha === "string" ? payload.reviewHeadSha : null;
  const mergedHeadSha =
    typeof payload.mergedHeadSha === "string" ? payload.mergedHeadSha : null;
  if (!baseRevision || !headRevision || !mergedHeadSha) return null;
  return {
    actor: viewer.name,
    role: viewer.role,
    event: "agent.review_merged",
    baseRevision,
    headRevision,
    mergedHeadSha,
  };
}

async function loadLatestIntegration(
  workspaceId: string,
  userId: string,
  viewer: ReviewViewer,
): Promise<ReviewIntegration | null> {
  const events = await listWorkspaceEvents(workspaceId, userId, 20);
  const merged = events.find((event) => event.type === "agent.review_merged");
  const payload =
    merged?.payload && typeof merged.payload === "object"
      ? (merged.payload as Record<string, unknown>)
      : null;
  return integrationFromPayload(viewer, payload);
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
      } catch (error) {
        if (
          !(error instanceof OrchestratorError && error.status === 403) ||
          !session.reviewHeadSha
        ) {
          return null;
        }
        const diffed = await executeInSandbox(workspaceId, {
          command: [
            "git",
            "--no-pager",
            "-c",
            "color.ui=never",
            "diff",
            "--binary",
            "--no-ext-diff",
            `${session.reviewBaseSha}...${session.reviewHeadSha}`,
            "--",
          ],
          worktreeId: session.worktreeId,
        });
        if (diffed.exitCode !== 0) return null;
        return [
          session.worktreeId,
          diffed.output.replace(/\r\n/g, "\n"),
        ] as const;
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
  const [viewer, listed, integrationHeadRevision] = await Promise.all([
    viewerFor(workspaceId, user),
    listAgentSessions(workspaceId),
    loadIntegrationHeadRevision(workspaceId),
  ]);
  const sessions = listed.map(asReviewSession);
  const diffs = {
    ...(await loadReviewDiffs(workspaceId, sessions)),
    ...diffOverrides,
  };
  const integration = await loadLatestIntegration(workspaceId, user.id, viewer);
  return toReviewSnapshot({
    viewer,
    sessions,
    diffs,
    integrationHeadRevision,
    integration,
  });
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

export async function advanceWorkspaceIntegration(
  workspaceId: string,
  user: { id: string; name?: string | null; githubLogin?: string },
) {
  await advanceIntegrationHead(workspaceId, user.id);
  return loadReviewSnapshot(workspaceId, user);
}

export async function mergeWorkspaceReview(
  workspaceId: string,
  user: { id: string; name?: string | null; githubLogin?: string },
  rawInput: unknown,
) {
  const { sessionId } = prepareReviewSchema.parse(rawInput);
  try {
    const merged = await mergeAgentReview(workspaceId, sessionId, user.id);
    const snapshot = await loadReviewSnapshot(workspaceId, user);
    return {
      ...snapshot,
      integrationHeadRevision: merged.headSha,
      approval: {
        state: "integrated" as const,
        blocked: false,
        mergeStarted: false,
      },
      integration: snapshot.integration ?? {
        actor: snapshot.viewer.name,
        role: snapshot.viewer.role,
        event: "agent.review_merged",
        baseRevision: snapshot.integrationHeadRevision ?? merged.headSha,
        headRevision: merged.headSha,
        mergedHeadSha: merged.headSha,
      },
    };
  } catch (error) {
    if (
      error instanceof ReviewActionError &&
      error.status === 409 &&
      /integration worktree advanced/i.test(error.message)
    ) {
      const snapshot = await loadReviewSnapshot(workspaceId, user);
      return {
        ...snapshot,
        approval: {
          state: "stale" as const,
          blocked: true,
          mergeStarted: false,
        },
      };
    }
    throw error;
  }
}

export async function applyWorkspaceReviewAction(
  workspaceId: string,
  user: { id: string; name?: string | null; githubLogin?: string },
  rawInput: unknown,
) {
  const input = reviewActionSchema.parse(rawInput ?? {});
  if (input.action === "advance") {
    return advanceWorkspaceIntegration(workspaceId, user);
  }
  if (input.action === "merge") {
    return mergeWorkspaceReview(workspaceId, user, input);
  }
  return prepareWorkspaceReview(workspaceId, user, input);
}
