import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { schema } from "@codev/db";

import { kickAgentSession } from "@/lib/agents/agent-service";
import { apiError } from "@/lib/http/api";
import { withWorkspace } from "@/lib/http/api-route";
import {
  parseAgentProvider,
  resolveSelectableAgentModel,
} from "@/lib/providers/ai-model";
import { assertProviderConnectionForTurn } from "@/lib/providers/provider-turn-auth";
import { getDatabase } from "@/lib/platform/database";
import { assertTurnQuota } from "@/lib/runtime/quotas";
import { ensureWorkspaceRuntimeReady } from "@/lib/runtime/runtime-resume";
import {
  agentAttachmentsSchema,
  toStoredAgentAttachments,
} from "@/lib/agents/agent-attachments";
import { enforceAgentPromptRateLimit } from "@/lib/agents/agent-rate-limit";

const inputSchema = z.object({
  prompt: z.string().trim().min(1).max(20_000),
  model: z.string().trim().min(1).max(120).optional(),
  attachments: agentAttachmentsSchema,
});

// Rate-limit, provider-connection and quota errors carry their own responses.
export const POST = withWorkspace<{ workspaceId: string; sessionId: string }>(
  "coSteer",
  async ({ request, user, workspaceId, params: { sessionId } }) => {
    const input = inputSchema.parse(await request.json());
    await ensureWorkspaceRuntimeReady(workspaceId, user.id);
    const [session] = await getDatabase()
      .select({
        id: schema.agentSessions.id,
        model: schema.agentSessions.model,
        provider: schema.agentSessions.provider,
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
    const provider = parseAgentProvider(session.provider);
    const credential = await assertProviderConnectionForTurn(
      user.id,
      workspaceId,
      provider,
    );
    await enforceAgentPromptRateLimit(user.id, workspaceId, provider);
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
      .values({
        sessionId,
        authorId: user.id,
        prompt: input.prompt,
        attachments: toStoredAgentAttachments(input.attachments),
      })
      .returning({ id: schema.agentTurns.id });
    await kickAgentSession(sessionId);
    return Response.json({ turnId: turn?.id }, { status: 202 });
  },
  { anyAuth: true },
);
