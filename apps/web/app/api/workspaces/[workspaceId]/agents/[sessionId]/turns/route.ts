import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { schema } from "@codev/db";

import { kickAgentSession } from "@/lib/agent-service";
import { apiError, getApiUser } from "@/lib/api";
import { getOpenAICredentialStatus } from "@/lib/credentials";
import { getDatabase } from "@/lib/database";
import { getWorkspaceForMember } from "@/lib/workspaces";

const inputSchema = z.object({
  prompt: z.string().trim().min(1).max(20_000),
});

export async function POST(
  request: Request,
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
    const input = inputSchema.parse(await request.json());
    if (!(await getOpenAICredentialStatus(user.id))) {
      return apiError(new Error("Add an OpenAI API key in Settings."), 409);
    }
    const [session] = await getDatabase()
      .select({ id: schema.agentSessions.id })
      .from(schema.agentSessions)
      .where(
        and(
          eq(schema.agentSessions.id, sessionId),
          eq(schema.agentSessions.workspaceId, workspaceId),
        ),
      )
      .limit(1);
    if (!session) return apiError(new Error("Agent session not found."), 404);

    const [turn] = await getDatabase()
      .insert(schema.agentTurns)
      .values({ sessionId, authorId: user.id, prompt: input.prompt })
      .returning({ id: schema.agentTurns.id });
    await kickAgentSession(sessionId);
    return Response.json({ turnId: turn?.id }, { status: 202 });
  } catch (error) {
    return apiError(error);
  }
}
