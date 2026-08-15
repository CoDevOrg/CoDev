import "server-only";

import { and, eq, inArray } from "drizzle-orm";
import { getRun } from "workflow/api";

import { schema } from "@codev/db";

import { getDatabase } from "./database";
import { appendWorkspaceEvent } from "./audit";
import { requireWorkspacePermission, type WorkspacePermission } from "./access";
import {
  checkpointSandboxWorktree,
  createSandboxWorktree,
  deleteSandboxWorktree,
  mergeSandboxWorktree,
  OrchestratorError,
  rebaseSandboxWorktree,
  reviewSandboxWorktree,
  type SandboxWorktreeReview,
} from "./orchestrator";
import { getWorkspaceForMember } from "./workspaces";

type ReviewTarget = {
  sessionId: string;
  workflowRunId: string | null;
  worktreeId: string;
  worktreeStatus: "active" | "frozen" | "merged" | "discarded";
  worktreeHeadSha: string;
  reviewHeadSha: string | null;
  reviewBaseSha: string | null;
  reviewDiffDigest: string | null;
  integrationId: string;
  integrationHeadSha: string;
};

async function requireReviewTarget(
  workspaceId: string,
  sessionId: string,
  userId: string,
  permission: WorkspacePermission = "merge",
): Promise<ReviewTarget> {
  const workspace = await getWorkspaceForMember(workspaceId, userId);
  if (!workspace) throw new ReviewActionError("Workspace not found.", 404);
  try {
    await requireWorkspacePermission(workspaceId, userId, permission);
  } catch (error) {
    throw new ReviewActionError(
      error instanceof Error
        ? error.message
        : permission === "review"
          ? "Reviewer capability is required to inspect this worktree."
          : "Merge capability is required for worktree decisions.",
      error instanceof Error && "status" in error ? Number(error.status) : 403,
    );
  }
  const [session] = await getDatabase()
    .select({
      sessionId: schema.agentSessions.id,
      workflowRunId: schema.agentSessions.workflowRunId,
      worktreeId: schema.worktrees.id,
      worktreeStatus: schema.worktrees.status,
      worktreeHeadSha: schema.worktrees.headSha,
      reviewHeadSha: schema.worktrees.reviewHeadSha,
      reviewBaseSha: schema.worktrees.reviewBaseSha,
      reviewDiffDigest: schema.worktrees.reviewDiffDigest,
    })
    .from(schema.agentSessions)
    .innerJoin(
      schema.worktrees,
      eq(schema.agentSessions.worktreeId, schema.worktrees.id),
    )
    .where(
      and(
        eq(schema.agentSessions.id, sessionId),
        eq(schema.agentSessions.workspaceId, workspaceId),
      ),
    )
    .limit(1);
  if (!session) throw new ReviewActionError("Agent session not found.", 404);
  const [integration] = await getDatabase()
    .select({
      id: schema.worktrees.id,
      headSha: schema.worktrees.headSha,
    })
    .from(schema.worktrees)
    .where(
      and(
        eq(schema.worktrees.workspaceId, workspaceId),
        eq(schema.worktrees.kind, "integration"),
      ),
    )
    .limit(1);
  if (!integration) {
    throw new ReviewActionError("Integration worktree not found.", 409);
  }
  return {
    ...session,
    integrationId: integration.id,
    integrationHeadSha: integration.headSha,
  };
}

async function stopAgentForReview(target: ReviewTarget) {
  if (target.workflowRunId) {
    await getRun(target.workflowRunId)
      .cancel()
      .catch(() => undefined);
  }
  const now = new Date();
  await getDatabase().transaction(async (transaction) => {
    await transaction
      .update(schema.agentTurns)
      .set({ status: "interrupted", finishedAt: now, updatedAt: now })
      .where(
        and(
          eq(schema.agentTurns.sessionId, target.sessionId),
          inArray(schema.agentTurns.status, ["queued", "running"]),
        ),
      );
    await transaction
      .update(schema.agentSessions)
      .set({
        status: "waiting",
        workflowRunId: null,
        interruptedAt: now,
        lastError: null,
        updatedAt: now,
      })
      .where(eq(schema.agentSessions.id, target.sessionId));
    await transaction
      .update(schema.worktrees)
      .set({ status: "frozen", updatedAt: now })
      .where(eq(schema.worktrees.id, target.worktreeId));
  });
}

async function persistReview(
  target: ReviewTarget,
  userId: string,
  review: SandboxWorktreeReview,
) {
  await getDatabase()
    .update(schema.worktrees)
    .set({
      status: "frozen",
      headSha: review.headSha,
      reviewHeadSha: review.headSha,
      reviewBaseSha: review.baseSha,
      reviewDiffDigest: review.diffDigest,
      reviewedBy: userId,
      reviewedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(schema.worktrees.id, target.worktreeId));
  return review;
}

async function assertReviewable(target: ReviewTarget) {
  if (
    target.worktreeStatus === "merged" ||
    target.worktreeStatus === "discarded"
  ) {
    throw new ReviewActionError(
      `This worktree is already ${target.worktreeStatus}.`,
      409,
    );
  }
  const [conflicts] = await getDatabase()
    .select({ count: schema.yjsSnapshots.id })
    .from(schema.yjsSnapshots)
    .where(
      and(
        inArray(schema.yjsSnapshots.worktreeId, [
          target.worktreeId,
          target.integrationId,
        ]),
        eq(schema.yjsSnapshots.hasConflict, true),
      ),
    )
    .limit(1);
  if (conflicts) {
    throw new ReviewActionError(
      "Resolve collaborative file conflicts before reviewing this worktree.",
      409,
    );
  }
}

export class ReviewActionError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly conflictPaths: string[] = [],
  ) {
    super(message);
    this.name = "ReviewActionError";
  }
}

const COMMIT_SHA = /^[0-9a-f]{40}$/;

function isMissingWorktreeError(error: unknown) {
  return (
    error instanceof OrchestratorError &&
    (error.status === 400 || error.status === 404) &&
    /worktree not found/i.test(error.message)
  );
}

async function checkpointSandboxWorktreeOrCreate(
  workspaceId: string,
  worktreeId: string,
  expectedHeadSha: string,
) {
  try {
    return await checkpointSandboxWorktree(
      workspaceId,
      worktreeId,
      expectedHeadSha,
    );
  } catch (error) {
    if (!isMissingWorktreeError(error)) throw error;
    await createSandboxWorktree(workspaceId, worktreeId, expectedHeadSha);
    return checkpointSandboxWorktree(workspaceId, worktreeId, expectedHeadSha);
  }
}

export async function prepareAgentReview(
  workspaceId: string,
  sessionId: string,
  userId: string,
) {
  const target = await requireReviewTarget(
    workspaceId,
    sessionId,
    userId,
    "review",
  );
  await assertReviewable(target);
  await stopAgentForReview(target);
  try {
    const expectedHeadSha = COMMIT_SHA.test(target.worktreeHeadSha)
      ? target.worktreeHeadSha
      : target.integrationHeadSha;
    if (!COMMIT_SHA.test(expectedHeadSha)) {
      throw new ReviewActionError(
        "This worktree has no reviewable revision yet.",
        409,
      );
    }
    const checkpoint = await checkpointSandboxWorktreeOrCreate(
      workspaceId,
      target.worktreeId,
      expectedHeadSha,
    );
    if (checkpoint.headSha !== target.worktreeHeadSha) {
      await getDatabase()
        .update(schema.worktrees)
        .set({ headSha: checkpoint.headSha, updatedAt: new Date() })
        .where(eq(schema.worktrees.id, target.worktreeId));
      target.worktreeHeadSha = checkpoint.headSha;
    }
    const review = await reviewSandboxWorktree(
      workspaceId,
      target.worktreeId,
      target.integrationHeadSha,
    );
    if (review.headSha !== checkpoint.headSha) {
      throw new ReviewActionError(
        "The worktree changed while its review was prepared.",
        409,
      );
    }
    return persistReview(target, userId, review);
  } catch (error) {
    await recordReviewFailure(target.sessionId, error);
    throw error;
  }
}

export async function rebaseAgentReview(
  workspaceId: string,
  sessionId: string,
  userId: string,
) {
  const target = await requireReviewTarget(workspaceId, sessionId, userId);
  await assertReviewable(target);
  if (!target.reviewHeadSha || !target.reviewBaseSha) {
    throw new ReviewActionError("Prepare a review before rebasing.", 409);
  }
  try {
    await rebaseSandboxWorktree(workspaceId, target.worktreeId, {
      expectedHeadSha: target.reviewHeadSha,
      ontoSha: target.integrationHeadSha,
    });
    const review = await reviewSandboxWorktree(
      workspaceId,
      target.worktreeId,
      target.integrationHeadSha,
    );
    return persistReview(target, userId, review);
  } catch (error) {
    await recordReviewFailure(target.sessionId, error);
    throw error;
  }
}

export async function mergeAgentReview(
  workspaceId: string,
  sessionId: string,
  userId: string,
) {
  const target = await requireReviewTarget(workspaceId, sessionId, userId);
  await assertReviewable(target);
  if (
    !target.reviewHeadSha ||
    !target.reviewBaseSha ||
    !target.reviewDiffDigest
  ) {
    throw new ReviewActionError("Prepare a review before merging.", 409);
  }
  if (target.reviewBaseSha !== target.integrationHeadSha) {
    throw new ReviewActionError(
      "The integration worktree advanced. Rebase and review again.",
      409,
    );
  }
  const contested = await getDatabase()
    .select({ id: schema.pathClaims.id })
    .from(schema.pathClaims)
    .where(
      and(
        eq(schema.pathClaims.sessionId, sessionId),
        eq(schema.pathClaims.status, "contested"),
      ),
    )
    .limit(1);
  if (contested.length) {
    throw new ReviewActionError(
      "Resolve contested path claims before merging.",
      409,
    );
  }
  try {
    const merged = await mergeSandboxWorktree(workspaceId, target.worktreeId, {
      expectedIntegrationHeadSha: target.integrationHeadSha,
      expectedWorktreeHeadSha: target.reviewHeadSha,
      expectedDiffDigest: target.reviewDiffDigest,
    });
    const now = new Date();
    await getDatabase().transaction(async (transaction) => {
      await transaction
        .update(schema.worktrees)
        .set({ headSha: merged.headSha, updatedAt: now })
        .where(eq(schema.worktrees.id, target.integrationId));
      await transaction
        .update(schema.worktrees)
        .set({
          headSha: target.reviewHeadSha!,
          status: "merged",
          mergedAt: now,
          updatedAt: now,
        })
        .where(eq(schema.worktrees.id, target.worktreeId));
      await transaction
        .update(schema.agentSessions)
        .set({
          status: "completed",
          workflowRunId: null,
          lastError: null,
          updatedAt: now,
        })
        .where(eq(schema.agentSessions.id, sessionId));
      await transaction
        .update(schema.pathClaims)
        .set({ status: "released", updatedAt: now })
        .where(
          and(
            eq(schema.pathClaims.sessionId, sessionId),
            inArray(schema.pathClaims.status, ["active", "contested"]),
          ),
        );
    });
    await appendWorkspaceEvent({
      workspaceId,
      actorId: userId,
      type: "agent.review_merged",
      payload: {
        sessionId,
        worktreeId: target.worktreeId,
        integrationWorktreeId: target.integrationId,
        reviewBaseSha: target.reviewBaseSha,
        reviewHeadSha: target.reviewHeadSha,
        mergedHeadSha: merged.headSha,
        reviewDiffDigest: target.reviewDiffDigest,
      },
    });
    await deleteSandboxWorktree(workspaceId, target.worktreeId).catch(
      () => undefined,
    );
    return { headSha: merged.headSha };
  } catch (error) {
    await recordReviewFailure(target.sessionId, error);
    throw error;
  }
}

export async function discardAgentWorktree(
  workspaceId: string,
  sessionId: string,
  userId: string,
) {
  const target = await requireReviewTarget(workspaceId, sessionId, userId);
  if (target.worktreeStatus === "discarded") return { status: "discarded" };
  if (target.worktreeStatus === "merged") {
    throw new ReviewActionError("A merged worktree cannot be discarded.", 409);
  }
  await stopAgentForReview(target);
  try {
    await deleteSandboxWorktree(workspaceId, target.worktreeId);
    const now = new Date();
    await getDatabase().transaction(async (transaction) => {
      await transaction
        .update(schema.worktrees)
        .set({ status: "discarded", discardedAt: now, updatedAt: now })
        .where(eq(schema.worktrees.id, target.worktreeId));
      await transaction
        .update(schema.agentSessions)
        .set({
          status: "completed",
          workflowRunId: null,
          lastError: null,
          updatedAt: now,
        })
        .where(eq(schema.agentSessions.id, sessionId));
      await transaction
        .update(schema.pathClaims)
        .set({ status: "released", updatedAt: now })
        .where(
          and(
            eq(schema.pathClaims.sessionId, sessionId),
            inArray(schema.pathClaims.status, ["active", "contested"]),
          ),
        );
    });
    await appendWorkspaceEvent({
      workspaceId,
      actorId: userId,
      type: "agent.review_discarded",
      payload: {
        sessionId,
        worktreeId: target.worktreeId,
        reviewBaseSha: target.reviewBaseSha,
        reviewHeadSha: target.reviewHeadSha,
        reviewDiffDigest: target.reviewDiffDigest,
        sandboxWorktreeRemoved: true,
        claimsReleased: true,
      },
    });
    return { status: "discarded" };
  } catch (error) {
    await recordReviewFailure(target.sessionId, error);
    throw error;
  }
}

async function recordReviewFailure(sessionId: string, error: unknown) {
  await getDatabase()
    .update(schema.agentSessions)
    .set({
      status: "waiting",
      lastError:
        error instanceof Error
          ? error.message.slice(0, 2_000)
          : "Worktree review failed.",
      updatedAt: new Date(),
    })
    .where(eq(schema.agentSessions.id, sessionId));
}
