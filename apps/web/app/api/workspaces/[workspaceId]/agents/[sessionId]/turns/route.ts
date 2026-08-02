import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { schema } from "@codev/db";

import { kickAgentSession } from "@/lib/agent-service";
import { apiError, getApiUser } from "@/lib/api";
import { getAgentProvider, resolveSelectableAgentModel } from "@/lib/ai-model";
import { requireWorkspacePermission } from "@/lib/access";
import { resolveAgentCredential } from "@/lib/credentials";
import { getDatabase } from "@/lib/database";
import { assertTurnQuota, QuotaError, quotaResponse } from "@/lib/quotas";
import { ensureWorkspaceRuntimeReady } from "@/lib/runtime-resume";
import {
  AgentPromptRateLimitError,
  enforceAgentPromptRateLimit,
} from "@/lib/agent-rate-limit";

const inputSchema = z.object({
  prompt: z.string().trim().min(1).max(20_000),
  model: z.string().trim().min(1).max(120).optional(),
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
  try {
    await requireWorkspacePermission(workspaceId, user.id, "coSteer");
  } catch (error) {
    return apiError(
      error,
      error instanceof Error && "status" in error ? Number(error.status) : 403,
    );
  }

  try {
    const input = inputSchema.parse(await request.json());
    const provider = getAgentProvider();
    const credential = await resolveAgentCredential(
      user.id,
      workspaceId,
      provider,
    );
    await enforceAgentPromptRateLimit(user.id, workspaceId, provider);
    await ensureWorkspaceRuntimeReady(workspaceId, user.id);
    const [session] = await getDatabase()
      .select({
        id: schema.agentSessions.id,
        model: schema.agentSessions.model,
      })
      .from(schema.agentSessions)
      .where(
        and(
          eq(schema.agentSessions.id, sessionId),
          eq(schema.agentSessions.workspaceId, workspaceId),
        ),
      )
      .limit(1);
    if (!session) return apiError(new Error("Agent session not found."), 404);
    await assertTurnQuota(user.id, sessionId);
    const model =
      !input.model || input.model === session.model
        ? session.model
        : await resolveSelectableAgentModel(input.model, provider, credential);

    if (session.model !== model) {
      await getDatabase()
        .update(schema.agentSessions)
        .set({ model })
        .where(eq(schema.agentSessions.id, sessionId));
    }

    const [turn] = await getDatabase()
      .insert(schema.agentTurns)
      .values({ sessionId, authorId: user.id, prompt: input.prompt })
      .returning({ id: schema.agentTurns.id });
    await kickAgentSession(sessionId);
    return Response.json({ turnId: turn?.id }, { status: 202 });
  } catch (error) {
    if (error instanceof AgentPromptRateLimitError) {
      return Response.json(
        { error: error.message, code: "agent_prompt_rate_limit" },
        {
          status: 429,
          headers: { "Retry-After": String(error.retryAfterSeconds) },
        },
      );
    }
    if (error instanceof QuotaError) return quotaResponse(error);
    return apiError(error);
  }
}
