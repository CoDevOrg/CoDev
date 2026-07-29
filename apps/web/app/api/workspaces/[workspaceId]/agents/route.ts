import { count, eq } from "drizzle-orm";
import { z } from "zod";

import { schema } from "@codev/db";

import { kickAgentSession } from "@/lib/agent-service";
import { listAgentSessions } from "@/lib/agent-runtime";
import { apiError, getApiUser } from "@/lib/api";
import { getOpenAICredentialStatus } from "@/lib/credentials";
import { getDatabase } from "@/lib/database";
import {
  createSandboxWorktree,
  deleteSandboxWorktree,
} from "@/lib/orchestrator";
import { getWorkspaceForMember } from "@/lib/workspaces";

const createSchema = z.object({
  name: z.string().trim().min(1).max(32),
  prompt: z.string().trim().min(1).max(20_000),
});

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  const user = await getApiUser();
  if (!user) return apiError(new Error("Authentication required."), 401);
  const { workspaceId } = await params;
  if (!(await getWorkspaceForMember(workspaceId, user.id))) {
    return apiError(new Error("Workspace not found."), 404);
  }
  return Response.json({ sessions: await listAgentSessions(workspaceId) });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  const user = await getApiUser();
  if (!user) return apiError(new Error("Authentication required."), 401);
  const { workspaceId } = await params;
  const workspace = await getWorkspaceForMember(workspaceId, user.id);
  if (!workspace) return apiError(new Error("Workspace not found."), 404);

  try {
    const input = createSchema.parse(await request.json());
    if (!(await getOpenAICredentialStatus(user.id))) {
      return apiError(
        new Error(
          "Add an OpenAI API key in Settings before starting an agent.",
        ),
        409,
      );
    }
    const [sessionCount] = await getDatabase()
      .select({ value: count() })
      .from(schema.agentSessions)
      .where(eq(schema.agentSessions.workspaceId, workspaceId));
    if (Number(sessionCount?.value ?? 0) >= 2) {
      return apiError(
        new Error("A workspace supports at most two agent sessions."),
        409,
      );
    }

    const [worktree] = await getDatabase()
      .insert(schema.worktrees)
      .values({
        workspaceId,
        kind: "agent",
        name: `agent-${input.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
        headSha: workspace.baseSha,
      })
      .returning({ id: schema.worktrees.id });
    if (!worktree) throw new Error("Could not reserve an agent worktree.");

    try {
      await createSandboxWorktree(workspaceId, worktree.id, workspace.baseSha);
      const [session] = await getDatabase()
        .insert(schema.agentSessions)
        .values({
          workspaceId,
          worktreeId: worktree.id,
          createdBy: user.id,
          name: input.name,
          model: "gpt-5.6-sol",
        })
        .returning({ id: schema.agentSessions.id });
      if (!session) throw new Error("Could not create the agent session.");
      await getDatabase().insert(schema.agentTurns).values({
        sessionId: session.id,
        authorId: user.id,
        prompt: input.prompt,
      });
      await kickAgentSession(session.id);
      return Response.json({ sessionId: session.id }, { status: 201 });
    } catch (error) {
      await deleteSandboxWorktree(workspaceId, worktree.id).catch(
        () => undefined,
      );
      await getDatabase()
        .delete(schema.worktrees)
        .where(eq(schema.worktrees.id, worktree.id));
      throw error;
    }
  } catch (error) {
    return apiError(error);
  }
}
