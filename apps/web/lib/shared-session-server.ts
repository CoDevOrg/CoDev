import "server-only";

import { and, eq } from "drizzle-orm";
import { getRun } from "workflow/api";

import { schema } from "@codev/db";

import { getWorkspaceAccess } from "./access";
import { listAgentSessions } from "./agent-runtime";
import { kickAgentSession } from "./agent-service";
import { lockAgentSession } from "./agent-session-lock";
import { getDatabase } from "./database";
import {
  PROVIDER_BOUNDARY_EVENT_TYPE,
  PROVIDER_SWITCH_DURING_TURN_EXPLANATION,
  isRestrictedFixtureProvider,
  isSelectableSharedProvider,
  unavailableControlExplanation,
  type ProviderCapabilityAction,
} from "./provider-capabilities";
import { fixtureProviderUsagePayload } from "./provider-event-view";
import {
  ProviderConnectionRequiredError,
  assertProviderConnectionForTurn,
} from "./provider-turn-auth";
import { assertTurnQuota } from "./quotas";
import {
  CONTROLLED_LAST_ACTION_OUTPUT,
  CONTROLLED_LAST_ACTION_TOOL,
  CONTROLLED_SEED_PROMPT,
  CONTROLLED_SHARED_TURN_PROMPT,
  displayMemberName,
  toSharedSessionView,
  type SharedSessionListItem,
  type SharedSessionSnapshot,
  type SharedSessionViewer,
} from "./shared-session-view";

export class SharedSessionError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "SharedSessionError";
  }
}

function asListItem(
  session: Awaited<ReturnType<typeof listAgentSessions>>[number],
): SharedSessionListItem {
  return {
    id: session.id,
    workspaceId: session.workspaceId,
    name: session.name,
    model: session.model,
    provider: session.provider,
    status: session.status,
    worktreeId: session.worktreeId,
    worktreeName: session.worktreeName,
    createdBy: session.createdBy,
    ownerName: session.ownerName,
    ownerLogin: session.ownerLogin,
    lastError: session.lastError,
    createdAt: session.createdAt,
    turns: session.turns.map((turn) => ({
      id: turn.id,
      authorId: turn.authorId,
      authorName: turn.authorName,
      authorLogin: turn.authorLogin,
      prompt: turn.prompt,
      status: turn.status,
      output: turn.output,
      lastError: turn.lastError,
      createdAt: turn.createdAt,
    })),
    events: session.events.map((event) => ({
      id: event.id,
      turnId: event.turnId,
      type: event.type,
      payload: event.payload,
      createdAt: event.createdAt,
    })),
  };
}

async function viewerFor(
  workspaceId: string,
  user: { id: string; name?: string | null; githubLogin?: string },
): Promise<SharedSessionViewer> {
  const access = await getWorkspaceAccess(workspaceId, user.id);
  return {
    id: user.id,
    name: displayMemberName(user.name, user.githubLogin),
    canCoSteer: Boolean(access?.permissions.coSteer),
  };
}

export async function loadSharedSessionSnapshot(
  workspaceId: string,
  user: { id: string; name?: string | null; githubLogin?: string },
): Promise<SharedSessionSnapshot> {
  const [viewer, sessions] = await Promise.all([
    viewerFor(workspaceId, user),
    listAgentSessions(workspaceId),
  ]);
  return {
    viewer,
    sharedSessions: sessions.map((session) =>
      toSharedSessionView(asListItem(session)),
    ),
  };
}

async function requireSession(workspaceId: string, sessionId: string) {
  const [session] = await getDatabase()
    .select({
      id: schema.agentSessions.id,
      status: schema.agentSessions.status,
      provider: schema.agentSessions.provider,
      workflowRunId: schema.agentSessions.workflowRunId,
    })
    .from(schema.agentSessions)
    .where(
      and(
        eq(schema.agentSessions.id, sessionId),
        eq(schema.agentSessions.workspaceId, workspaceId),
      ),
    )
    .limit(1);
  if (!session) {
    throw new SharedSessionError("Agent session not found.", 404);
  }
  return session;
}

async function requireLiveProviderConnection(
  workspaceId: string,
  userId: string,
  provider: string,
) {
  if (isRestrictedFixtureProvider(provider)) return;
  try {
    await assertProviderConnectionForTurn(userId, workspaceId, provider);
  } catch (error) {
    if (error instanceof ProviderConnectionRequiredError) {
      throw new SharedSessionError(error.message, error.status);
    }
    throw error;
  }
}

function requireProviderCapability(
  provider: string,
  action: ProviderCapabilityAction,
) {
  const explanation = unavailableControlExplanation(provider, action);
  if (explanation) {
    throw new SharedSessionError(explanation, 409);
  }
}

async function recordSharedEvent(input: {
  workspaceId: string;
  sessionId: string;
  turnId: string;
  type: string;
  payload: Record<string, unknown>;
  idempotencyKey?: string;
}) {
  await getDatabase()
    .insert(schema.agentEvents)
    .values({
      workspaceId: input.workspaceId,
      sessionId: input.sessionId,
      turnId: input.turnId,
      idempotencyKey:
        input.idempotencyKey ??
        `shared:${input.sessionId}:${input.type}:${input.turnId}`,
      type: input.type,
      payload: input.payload,
    })
    .onConflictDoNothing({
      target: schema.agentEvents.idempotencyKey,
    });
}

export async function startControlledSharedSessionTurn(
  workspaceId: string,
  sessionId: string,
  user: { id: string; name?: string | null; githubLogin?: string },
) {
  const session = await requireSession(workspaceId, sessionId);
  if (session.status === "running") {
    return loadSharedSessionSnapshot(workspaceId, user);
  }

  requireProviderCapability(session.provider, "startControlled");
  await requireLiveProviderConnection(workspaceId, user.id, session.provider);
  await assertTurnQuota(user.id, sessionId);

  const turns = await getDatabase()
    .select({
      id: schema.agentTurns.id,
      status: schema.agentTurns.status,
      output: schema.agentTurns.output,
    })
    .from(schema.agentTurns)
    .where(eq(schema.agentTurns.sessionId, sessionId));
  const hasCompletedOutput = turns.some(
    (turn) => turn.status === "completed" && turn.output,
  );
  const now = new Date();

  if (!hasCompletedOutput) {
    const [seed] = await getDatabase()
      .insert(schema.agentTurns)
      .values({
        sessionId,
        authorId: user.id,
        prompt: CONTROLLED_SEED_PROMPT,
        status: "completed",
        output: CONTROLLED_LAST_ACTION_OUTPUT,
        startedAt: now,
        finishedAt: now,
      })
      .returning({ id: schema.agentTurns.id });
    if (seed) {
      await recordSharedEvent({
        workspaceId,
        sessionId,
        turnId: seed.id,
        type: "tool.completed",
        payload: {
          name: CONTROLLED_LAST_ACTION_TOOL,
          text: CONTROLLED_LAST_ACTION_OUTPUT,
          turnId: seed.id,
          ...fixtureProviderUsagePayload(),
        },
      });
    }
  }

  const [running] = await getDatabase()
    .insert(schema.agentTurns)
    .values({
      sessionId,
      authorId: user.id,
      prompt: CONTROLLED_SHARED_TURN_PROMPT,
      status: "running",
      startedAt: now,
    })
    .returning({ id: schema.agentTurns.id });
  if (running) {
    await recordSharedEvent({
      workspaceId,
      sessionId,
      turnId: running.id,
      type: "shared_session.turn.started",
      payload: { turnId: running.id, queuePosition: 1 },
    });
  }

  await getDatabase()
    .update(schema.agentSessions)
    .set({
      status: "running",
      lastError: null,
      interruptedAt: null,
      updatedAt: now,
    })
    .where(eq(schema.agentSessions.id, sessionId));

  return loadSharedSessionSnapshot(workspaceId, user);
}

export async function enqueueSharedSessionInstruction(
  workspaceId: string,
  sessionId: string,
  user: { id: string; name?: string | null; githubLogin?: string },
  prompt: string,
) {
  const trimmed = prompt.trim();
  if (!trimmed) {
    throw new SharedSessionError("An instruction is required.", 400);
  }
  const session = await requireSession(workspaceId, sessionId);
  requireProviderCapability(session.provider, "queue");
  await requireLiveProviderConnection(workspaceId, user.id, session.provider);
  const now = new Date();
  const turn = await getDatabase().transaction(async (transaction) => {
    await lockAgentSession(transaction, sessionId);
    await assertTurnQuota(user.id, sessionId);
    const [inserted] = await transaction
      .insert(schema.agentTurns)
      .values({
        sessionId,
        authorId: user.id,
        prompt: trimmed,
        status: "queued",
      })
      .returning({ id: schema.agentTurns.id });
    if (inserted) {
      await transaction
        .update(schema.agentSessions)
        .set({ updatedAt: now })
        .where(eq(schema.agentSessions.id, sessionId));
    }
    return inserted;
  });
  if (!turn) {
    throw new SharedSessionError("Could not queue this instruction.", 500);
  }
  await recordSharedEvent({
    workspaceId,
    sessionId,
    turnId: turn.id,
    type: "shared_session.turn.queued",
    payload: {
      turnId: turn.id,
      authorId: user.id,
      prompt: trimmed,
    },
  });
  await kickAgentSession(sessionId);
  return loadSharedSessionSnapshot(workspaceId, user);
}

export async function interruptSharedSession(
  workspaceId: string,
  sessionId: string,
  user: { id: string; name?: string | null; githubLogin?: string },
) {
  const session = await requireSession(workspaceId, sessionId);
  requireProviderCapability(session.provider, "interrupt");
  if (session.workflowRunId) {
    await getRun(session.workflowRunId).cancel();
  }
  const now = new Date();
  const runningTurns = await getDatabase()
    .update(schema.agentTurns)
    .set({ status: "interrupted", finishedAt: now, updatedAt: now })
    .where(
      and(
        eq(schema.agentTurns.sessionId, sessionId),
        eq(schema.agentTurns.status, "running"),
      ),
    )
    .returning({ id: schema.agentTurns.id });
  await getDatabase()
    .update(schema.agentSessions)
    .set({
      status: "interrupted",
      workflowRunId: null,
      interruptedAt: now,
      updatedAt: now,
    })
    .where(eq(schema.agentSessions.id, sessionId));
  for (const turn of runningTurns) {
    await recordSharedEvent({
      workspaceId,
      sessionId,
      turnId: turn.id,
      type: "shared_session.turn.interrupted",
      payload: {
        turnId: turn.id,
        reason: `Cancelled by ${displayMemberName(user.name, user.githubLogin)}.`,
      },
    });
  }
  return loadSharedSessionSnapshot(workspaceId, user);
}

export async function selectSharedSessionProvider(
  workspaceId: string,
  sessionId: string,
  user: { id: string; name?: string | null; githubLogin?: string },
  provider: string,
) {
  if (!isSelectableSharedProvider(provider)) {
    throw new SharedSessionError(
      "Choose OpenAI or the restricted fixture provider.",
      400,
    );
  }
  const session = await requireSession(workspaceId, sessionId);
  if (session.status === "running") {
    throw new SharedSessionError(PROVIDER_SWITCH_DURING_TURN_EXPLANATION, 409);
  }
  if (session.provider !== provider) {
    const finishedTurns = await getDatabase()
      .select({
        id: schema.agentTurns.id,
        status: schema.agentTurns.status,
        createdAt: schema.agentTurns.createdAt,
      })
      .from(schema.agentTurns)
      .where(eq(schema.agentTurns.sessionId, sessionId));
    const afterTurn = [...finishedTurns]
      .sort(
        (left, right) => left.createdAt.getTime() - right.createdAt.getTime(),
      )
      .reverse()
      .find(
        (turn) =>
          turn.status === "completed" ||
          turn.status === "interrupted" ||
          turn.status === "failed",
      );
    if (!afterTurn) {
      throw new SharedSessionError(
        "Switch after a completed fixture turn. The current transcript has no completed turn to bound.",
        409,
      );
    }
    await getDatabase()
      .update(schema.agentSessions)
      .set({ provider, lastError: null, updatedAt: new Date() })
      .where(eq(schema.agentSessions.id, sessionId));
    await recordSharedEvent({
      workspaceId,
      sessionId,
      turnId: afterTurn.id,
      type: PROVIDER_BOUNDARY_EVENT_TYPE,
      idempotencyKey: `shared:${sessionId}:provider.boundary:${session.provider}:${provider}:${afterTurn.id}`,
      payload: {
        from: session.provider,
        to: provider,
        afterTurnId: afterTurn.id,
      },
    });
  }
  return loadSharedSessionSnapshot(workspaceId, user);
}
