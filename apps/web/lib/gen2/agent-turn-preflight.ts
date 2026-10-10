import "server-only";

import { requireWorkspaceOwnerPlan } from "../billing/gate";
import { avoidBlockedCliModel } from "./agent-cli-fallback";
import { applyGen2GoalControl } from "./agent-goal-control";
import { loadGen2AgentModels, requireGen2AgentModel } from "./agent-model";
import { canRunGen2Agent } from "./agent-policy";
import {
  buildGen2TurnContext,
  type Gen2TurnHistory,
} from "./agent-turn-context";
import {
  claimGen2ChatProvider,
  listGen2ChatMessages,
  requireGen2Chat,
} from "./chats";
import { findPossibleDuplicateTask } from "./duplicate-task-check";
import { Gen2AccessError, Gen2LifecycleError } from "./errors";
import { parseGen2PromptCommand } from "./prompt-command";
import type { Gen2AgentProvider } from "./providers";
import { requireGen2Member } from "./workspaces";

export type Gen2AgentTurnInput = {
  workspaceId: string;
  userId: string;
  chatId: string;
  prompt: string;
  idempotencyKey: string;
  provider: Gen2AgentProvider;
  worktreeId?: string | undefined;
  model?: string | undefined;
  acknowledgedDuplicateOf?: string | undefined;
  /** What the member sees; parsed leniently, never persisted or trusted. */
  workspaceContext?: unknown;
  /** A re-run of the latest prompt on a fallback model, with its history. */
  continuation?: { history: Gen2TurnHistory };
};

async function requireAgentRunner(workspaceId: string, userId: string) {
  const membership = await requireGen2Member(workspaceId, userId);
  if (!canRunGen2Agent(membership.status)) {
    throw new Gen2LifecycleError(
      membership.status === "provisioning"
        ? "The instance is still starting."
        : "Start the instance before asking Codex to work.",
    );
  }
  if (membership.role === "viewer")
    throw new Gen2AccessError(
      "Edit permission is required to run agents.",
      403,
    );
  return membership;
}

/**
 * Every database trip crosses the country, so independent checks run
 * together instead of one after another. The history is used only once the
 * chat is known to be in this workspace.
 */
function checkTurn(input: Gen2AgentTurnInput) {
  return Promise.all([
    requireWorkspaceOwnerPlan(input.workspaceId),
    requireGen2Chat(input.workspaceId, input.chatId).then(async () => {
      await claimGen2ChatProvider(input.chatId, input.provider);
      if (input.continuation) return null;
      return findPossibleDuplicateTask(input);
    }),
    loadGen2AgentModels(input.provider, input.userId),
    input.continuation?.history ?? listGen2ChatMessages(input.chatId),
  ]);
}

/**
 * What `startGen2AgentTurn` settles before it claims a seat or starts a
 * process. Returns the whole `response` for a goal change (no agent runs)
 * or a possible duplicate, or else the `turn` to start: its model, history
 * and context.
 */
export async function prepareGen2AgentTurn(input: Gen2AgentTurnInput) {
  const membership = await requireAgentRunner(input.workspaceId, input.userId);
  if (!input.continuation && parseGen2PromptCommand(input.prompt).goalControl)
    return { response: await applyGen2GoalControl(input) };
  const [, possibleDuplicate, models, history] = await checkTurn(input);
  if (
    possibleDuplicate &&
    possibleDuplicate.runId !== input.acknowledgedDuplicateOf
  )
    return { response: { possibleDuplicate } };

  const requested = requireGen2AgentModel(models, input.model);
  // A model the live workspace CLI is known not to support runs on the
  // closest one it does, with a note, until the CLI update ships.
  const { model, note } = input.continuation
    ? { model: requested, note: null }
    : await avoidBlockedCliModel(input.provider, requested, models);
  if (!model) throw new Gen2LifecycleError(note!, 409);

  // A fallback re-run rebuilds its mode, goal and mentions from the persisted
  // prompt; the member's view and the action protocol belong to the original.
  const context = await buildGen2TurnContext({
    workspaceId: input.workspaceId,
    chatId: input.chatId,
    prompt: input.prompt,
    role: membership.role,
    history,
    workspaceContext: input.continuation ? undefined : input.workspaceContext,
    includeProtocol: !input.continuation,
  });
  return {
    turn: {
      requested,
      model,
      fallbackNote: note,
      history,
      context: context.blocks,
      actionNonce: context.actionNonce ?? undefined,
    },
  };
}
