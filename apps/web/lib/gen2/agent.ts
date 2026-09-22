import "server-only";

import type { Gen2ProviderId } from "@codev/contracts";

import { logEvent } from "../platform/observability";
import { Gen2AccessError, Gen2LifecycleError } from "./errors";
import { describeGen2RuntimeFailure } from "./instance";
import { canRunGen2Agent } from "./agent-policy";
import {
  appendGen2ChatMessage,
  listGen2ChatMessages,
  requireGen2Chat,
} from "./chats";
import { getGen2ProviderAdapter } from "./provider-adapters";
import { createGen2Turn, recordGen2TurnChunks, requireGen2Turn } from "./turns";
import {
  getWorkspaceAccess,
  requireWorkspacePermission,
} from "../policies/workspace";
import { getGen2WorkspaceForAccess } from "./workspaces";
import { getGen2AgentExecutionPolicyForAccess } from "./workspace-policy";

export { canRunGen2Agent } from "./agent-policy";

async function requireReadyWorkspace(workspaceId: string, userId: string) {
  const access = await requireWorkspacePermission(
    workspaceId,
    userId,
    "agent.run",
  );
  const workspace = await getGen2WorkspaceForAccess(workspaceId, access);
  if (!canRunGen2Agent(workspace.status)) {
    throw new Gen2LifecycleError(
      workspace.status === "provisioning"
        ? "The instance is still starting."
        : "Start the instance before asking an agent to work.",
    );
  }
  return { access, workspace };
}

export async function startGen2AgentTurn(input: {
  workspaceId: string;
  userId: string;
  chatId: string;
  prompt: string;
  idempotencyKey: string;
  provider?: Gen2ProviderId;
}) {
  const { access } = await requireReadyWorkspace(
    input.workspaceId,
    input.userId,
  );
  await requireWorkspacePermission(
    input.workspaceId,
    input.userId,
    "context.includeInTurn",
  );
  const chat = await requireGen2Chat(input.workspaceId, input.chatId);
  const history = await listGen2ChatMessages(input.chatId);
  const provider = input.provider ?? chat.defaultProvider;
  const adapter = getGen2ProviderAdapter(provider);
  const executionPolicy = await getGen2AgentExecutionPolicyForAccess(
    input.workspaceId,
    access,
  );
  try {
    const { sessionId } = await adapter.start({
      workspaceId: input.workspaceId,
      userId: input.userId,
      prompt: input.prompt,
      history,
      idempotencyKey: input.idempotencyKey,
      executionPolicy,
    });
    try {
      await appendGen2ChatMessage({
        chatId: input.chatId,
        role: "user",
        body: input.prompt,
      });
    } catch (error) {
      logEvent("error", "gen2.agent.persist_user_failed", {
        detail: error instanceof Error ? error.message : "unknown",
      });
    }
    // From here the server owns the transcript: every poll appends to this
    // row, so the reply survives the browser going away mid-turn.
    await createGen2Turn({
      sessionId,
      workspaceId: input.workspaceId,
      chatId: input.chatId,
      userId: input.userId,
      provider,
    });
    return { sessionId, provider };
  } catch (error) {
    logEvent("error", "gen2.agent.start_failed", {
      detail: error instanceof Error ? error.message : "unknown",
    });
    if (hasStatus(error) && error.status === 404) {
      throw new Gen2LifecycleError(
        "The instance is not running. Start it and try again.",
      );
    }
    if (
      error instanceof Gen2AccessError ||
      error instanceof Gen2LifecycleError ||
      hasStatus(error)
    ) {
      throw error;
    }
    throw new Gen2LifecycleError(describeGen2RuntimeFailure(error), 502);
  }
}

export async function pollGen2AgentTurn(input: {
  workspaceId: string;
  userId: string;
  chatId?: string;
  sessionId: string;
  after: number;
}) {
  // Turns and their persisted transcript are workspace-shared. Any member
  // with context.view may poll a turn, while only its initiator (or a member
  // with agent.cancelAny) may cancel it. The immutable turn owner remains the
  // sole authority for provider credential cleanup.
  await requireWorkspacePermission(
    input.workspaceId,
    input.userId,
    "context.view",
  );
  const turn = await requireGen2Turn(input.workspaceId, input.sessionId);
  const adapter = getGen2ProviderAdapter(turn.provider);
  let result;
  try {
    result = await adapter.poll({
      workspaceId: input.workspaceId,
      turnOwnerId: turn.userId,
      sessionId: input.sessionId,
      after: input.after,
    });
  } catch (error) {
    logEvent("error", "gen2.agent.poll_failed", {
      detail: error instanceof Error ? error.message : "unknown",
    });
    if (hasStatus(error) && error.status === 404) {
      await adapter.release(turn.userId);
      throw new Gen2LifecycleError(
        "This agent turn is no longer running. Send the prompt again.",
      );
    }
    throw new Gen2LifecycleError(describeGen2RuntimeFailure(error), 502);
  }

  const persisted = await recordGen2TurnChunks({
    sessionId: input.sessionId,
    chunks: result.chunks,
    exited: result.exited,
  });

  return {
    chunks: result.chunks,
    nextSequence: result.nextSequence,
    exited: result.exited,
    exitCode: result.exitCode,
    // Present only on the poll that ends the turn: the reply the server
    // already saved, so the client does not have to save it too.
    reply: persisted?.reply ?? null,
    persistedMessageId: persisted?.messageId ?? null,
  };
}

export async function cancelGen2AgentTurn(input: {
  workspaceId: string;
  userId: string;
  sessionId: string;
}) {
  const access = await getWorkspaceAccess(input.workspaceId, input.userId);
  if (!access) {
    throw new Gen2AccessError("You don't have access to this workspace.", 403);
  }
  const turn = await requireGen2Turn(input.workspaceId, input.sessionId);
  await requireWorkspacePermission(
    input.workspaceId,
    input.userId,
    turn.userId === input.userId ? "agent.cancelOwn" : "agent.cancelAny",
  );
  const adapter = getGen2ProviderAdapter(turn.provider);
  try {
    await adapter.cancel({
      workspaceId: input.workspaceId,
      turnOwnerId: turn.userId,
      sessionId: input.sessionId,
    });
  } catch (error) {
    throw new Gen2LifecycleError(describeGen2RuntimeFailure(error), 502);
  }
}

function hasStatus(error: unknown): error is { status: number } {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    typeof error.status === "number"
  );
}
