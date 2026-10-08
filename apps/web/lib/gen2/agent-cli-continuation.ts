import "server-only";

import { eq } from "drizzle-orm";
import { schema } from "@codev/db";
import { gen2AgentProviderSchema } from "@codev/contracts";
import { getDatabase } from "../platform/database";
import { logEvent } from "../platform/observability";
import { getDynamicModelsForProvider } from "../providers/dynamic-models";
import { startGen2AgentTurn } from "./agent";
import {
  blockedCliModels,
  closestFallbackModel,
  fallbackNote,
  recordCliModelRequirement,
  type CliModelRequirement,
} from "./agent-cli-fallback";
import { appendGen2ChatMessage, listGen2ChatMessages } from "./chats";

async function startOnFallback(
  turn: typeof schema.gen2AgentTurns.$inferSelect & { model: string },
  provider: ReturnType<typeof gen2AgentProviderSchema.parse>,
  requirement: CliModelRequirement,
) {
  const models = await getDynamicModelsForProvider(provider, turn.userId);
  const to = closestFallbackModel(
    turn.model,
    models,
    await blockedCliModels(turn.provider),
  );
  const messages = await listGen2ChatMessages(turn.chatId);
  const last = messages.map((message) => message.role).lastIndexOf("user");
  if (!to || last === -1) return null;
  const started = await startGen2AgentTurn({
    workspaceId: turn.workspaceId,
    userId: turn.userId,
    chatId: turn.chatId,
    prompt: messages[last]!.body,
    idempotencyKey: `${turn.sessionId}:cli-fallback`,
    provider,
    model: to,
    worktreeId: turn.worktreeId ?? undefined,
    continuation: { history: messages.slice(0, last) },
  });
  if (!("sessionId" in started) || !started.sessionId) return null;
  await appendGen2ChatMessage({
    chatId: turn.chatId,
    role: "assistant",
    body: fallbackNote({ provider, from: turn.model, to, requirement }),
  });
  return started.sessionId;
}

/**
 * Re-runs a turn whose CLI could not run its model on the closest model it
 * can, so the member gets an answer and a note instead of the CLI's error.
 * Returns the new session for the browser to follow.
 */
export async function continueOnFallbackModel(
  sessionId: string,
  requirement: CliModelRequirement,
) {
  const [turn] = await getDatabase()
    .select()
    .from(schema.gen2AgentTurns)
    .where(eq(schema.gen2AgentTurns.sessionId, sessionId))
    .limit(1);
  const provider = gen2AgentProviderSchema.safeParse(turn?.provider);
  if (!turn?.model || !provider.success) return null;
  const model = turn.model;
  await recordCliModelRequirement({
    provider: turn.provider,
    model,
    requirement,
  });
  const continued = await startOnFallback(
    { ...turn, model },
    provider.data,
    requirement,
  ).catch((error: unknown) => {
    logEvent("warn", "gen2.agent.cli_fallback_failed", {
      sessionId,
      detail: error instanceof Error ? error.message : "unknown",
    });
    return null;
  });
  if (!continued) {
    await appendGen2ChatMessage({
      chatId: turn.chatId,
      role: "assistant",
      body: fallbackNote({
        provider: turn.provider,
        from: model,
        to: null,
        requirement,
      }),
    });
    return null;
  }
  await getDatabase()
    .update(schema.gen2AgentTurns)
    .set({ continuedAsSessionId: continued })
    .where(eq(schema.gen2AgentTurns.sessionId, sessionId));
  return continued;
}

/** Lets a browser that polls a finished turn late still follow its re-run. */
export async function continuedSessionId(sessionId: string) {
  const [turn] = await getDatabase()
    .select({ continued: schema.gen2AgentTurns.continuedAsSessionId })
    .from(schema.gen2AgentTurns)
    .where(eq(schema.gen2AgentTurns.sessionId, sessionId))
    .limit(1);
  return turn?.continued ?? null;
}
