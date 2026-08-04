import { and, eq } from "drizzle-orm";
import { getRun } from "workflow/api";

import { schema } from "@codev/db";

import { apiError, getApiUser } from "@/lib/api";
import { requireWorkspacePermission } from "@/lib/access";
import { deleteSandboxWorktree } from "@/lib/orchestrator";
import { getDatabase } from "@/lib/database";
import { ensureWorkspaceRuntimeReady } from "@/lib/runtime-resume";

export async function DELETE(
  _request: Request,
  {
    params,
  }: {
    params: Promise<{ workspaceId: string; sessionId: string }>;
  },
) {
  const user = await getApiUser();
  if (!user) return apiError(new Error("Authentication required."), 401);
  const { workspaceId, sessionId } = await params;

  try {
    await requireWorkspacePermission(workspaceId, user.id, "coSteer");
  } catch (error) {
    return apiError(
      error,
      error instanceof Error && "status" in error ? Number(error.status) : 403,
    );
  }

  try {
    const [target] = await getDatabase()
      .select({
        sessionId: schema.agentSessions.id,
        workflowRunId: schema.agentSessions.workflowRunId,
        worktreeId: schema.worktrees.id,
        worktreeStatus: schema.worktrees.status,
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

    if (!target) return apiError(new Error("Agent session not found."), 404);

    if (target.workflowRunId) {
      await getRun(target.workflowRunId)
        .cancel()
        .catch(() => undefined);
    }

    if (
      target.worktreeStatus === "active" ||
      target.worktreeStatus === "frozen"
    ) {
      await ensureWorkspaceRuntimeReady(workspaceId, user.id);
      await deleteSandboxWorktree(workspaceId, target.worktreeId);
    }

    await getDatabase().transaction(async (transaction) => {
      await transaction
        .delete(schema.agentSessions)
        .where(eq(schema.agentSessions.id, target.sessionId));
      await transaction
        .delete(schema.worktrees)
        .where(eq(schema.worktrees.id, target.worktreeId));
    });

    return new Response(null, { status: 204 });
  } catch (error) {
    return apiError(error);
  }
}
