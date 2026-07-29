import { and, eq } from "drizzle-orm";
import { getRun } from "workflow/api";

import { schema } from "@codev/db";

import { apiError, getApiUser } from "@/lib/api";
import { getDatabase } from "@/lib/database";
import { getWorkspaceForMember } from "@/lib/workspaces";

export async function POST(
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
  if (!(await getWorkspaceForMember(workspaceId, user.id))) {
    return apiError(new Error("Workspace not found."), 404);
  }

  try {
    const [session] = await getDatabase()
      .select({ workflowRunId: schema.agentSessions.workflowRunId })
      .from(schema.agentSessions)
      .where(
        and(
          eq(schema.agentSessions.id, sessionId),
          eq(schema.agentSessions.workspaceId, workspaceId),
        ),
      )
      .limit(1);
    if (!session) return apiError(new Error("Agent session not found."), 404);
    if (session.workflowRunId) {
      await getRun(session.workflowRunId).cancel();
    }
    const now = new Date();
    await getDatabase()
      .update(schema.agentSessions)
      .set({
        status: "interrupted",
        workflowRunId: null,
        interruptedAt: now,
        updatedAt: now,
      })
      .where(eq(schema.agentSessions.id, sessionId));
    await getDatabase()
      .update(schema.agentTurns)
      .set({ status: "interrupted", finishedAt: now, updatedAt: now })
      .where(
        and(
          eq(schema.agentTurns.sessionId, sessionId),
          eq(schema.agentTurns.status, "running"),
        ),
      );
    return Response.json({ status: "interrupted" });
  } catch (error) {
    return apiError(error);
  }
}
