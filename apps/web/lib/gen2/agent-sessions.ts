import "server-only";

import { and, eq } from "drizzle-orm";

import { schema } from "@codev/db";

import { getDatabase } from "../platform/database";
import { Gen2LifecycleError } from "./errors";

type CreateGen2AgentSessionInput = {
  workspaceId: string;
  chatId: string;
  createdBy: string;
  task: string;
  worktreeId: string;
  provider: string;
  idempotencyKey: string;
};

/**
 * Creates the durable task record before its first process starts. A retry
 * returns only the same task identity; divergent retries never repurpose it.
 */
export async function createGen2AgentSession(
  input: CreateGen2AgentSessionInput,
) {
  const database = getDatabase();
  await database
    .insert(schema.gen2AgentSessions)
    .values({
      workspaceId: input.workspaceId,
      chatId: input.chatId,
      createdBy: input.createdBy,
      task: input.task,
      worktreeId: input.worktreeId,
      provider:
        input.provider as (typeof schema.credentialProvider.enumValues)[number],
      idempotencyKey: input.idempotencyKey,
    })
    .onConflictDoNothing();

  const [session] = await database
    .select()
    .from(schema.gen2AgentSessions)
    .where(
      and(
        eq(schema.gen2AgentSessions.workspaceId, input.workspaceId),
        eq(schema.gen2AgentSessions.idempotencyKey, input.idempotencyKey),
      ),
    )
    .limit(1);
  if (!session || session.createdBy !== input.createdBy) {
    throw new Gen2LifecycleError("Agent session not found.", 404);
  }
  if (
    session.chatId !== input.chatId ||
    session.task !== input.task ||
    session.worktreeId !== input.worktreeId ||
    session.provider !== input.provider
  ) {
    throw new Gen2LifecycleError(
      "This agent request conflicts with an existing session.",
      409,
    );
  }
  return session;
}
