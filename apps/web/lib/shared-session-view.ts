import {
  orderSharedSessionQueue,
  sharedSessionSchema,
  type SharedSession,
} from "@codev/contracts";

import {
  PROVIDER_BOUNDARY_EVENT_TYPE,
  capabilitiesForProvider,
  listProviderCapabilities,
  providerSwitchLabel,
  type ProviderCapabilityFlags,
} from "./provider-capabilities";
import {
  toNormalizedProviderEvents,
  type NormalizedProviderEvent,
} from "./provider-event-view";
import { isProviderConnectionBlockMessage } from "./provider-turn-auth";

export const CONTROLLED_SHARED_TURN_PROMPT = "Controlled shared-session turn";
export const CONTROLLED_LAST_ACTION_TOOL = "read_file · README.md";
export const CONTROLLED_LAST_ACTION_OUTPUT =
  "Repository structure is ready for the shared session.";
export const CONTROLLED_SEED_PROMPT = "Inspect the repository layout.";

export type SharedSessionViewer = {
  id: string;
  name: string;
  canCoSteer: boolean;
};

export type SharedSessionTranscriptTurn = {
  position: number;
  turnId: string;
  authorId: string;
  authorName: string;
  prompt: string;
  status: "completed" | "interrupted" | "failed";
  tool: string | null;
  output: string | null;
  provider: string;
  providerLabel: string;
};

export type SharedSessionProviderBoundary = {
  id: string;
  from: string;
  to: string;
  fromLabel: string;
  toLabel: string;
  afterTurnId: string | null;
  label: string;
};

export type SharedSessionLastAction = {
  tool: string;
  output: string;
};

export type SharedSessionView = {
  session: SharedSession;
  name: string;
  ownerName: string;
  activeTurnAuthorName: string | null;
  worktreeName: string;
  model: string;
  attributedQueue: Array<{
    id: string;
    authorId: string;
    authorName: string;
    prompt: string;
    queuePosition: number;
    enqueuedAt: string;
  }>;
  transcript: SharedSessionTranscriptTurn[];
  lastCompletedAction: SharedSessionLastAction | null;
  connectionBlocked: string | null;
  providerEvents: NormalizedProviderEvent[];
  capabilities: ProviderCapabilityFlags;
  availableProviders: ProviderCapabilityFlags[];
  providerBoundaries: SharedSessionProviderBoundary[];
};

export type SharedSessionSnapshot = {
  viewer: SharedSessionViewer;
  sharedSessions: SharedSessionView[];
};

export type SharedSessionListTurn = {
  id: string;
  authorId: string;
  authorName?: string | null;
  authorLogin?: string | null;
  prompt: string;
  status: string;
  output?: string | null;
  lastError?: string | null;
  createdAt: Date | string;
};

export type SharedSessionListEvent = {
  id: string;
  turnId?: string | null;
  type: string;
  payload: Record<string, unknown> | null;
  createdAt: Date | string;
};

export type SharedSessionListItem = {
  id: string;
  workspaceId: string;
  name: string;
  model: string;
  provider: string;
  status: SharedSession["state"];
  worktreeId: string;
  worktreeName: string;
  createdBy: string;
  ownerName?: string | null;
  ownerLogin?: string | null;
  lastError?: string | null;
  createdAt: Date | string;
  turns: SharedSessionListTurn[];
  events: SharedSessionListEvent[];
};

function iso(value: Date | string) {
  return value instanceof Date ? value.toISOString() : value;
}

export function displayMemberName(
  name: string | null | undefined,
  login: string | null | undefined,
  fallback = "Member",
) {
  const trimmedName = name?.trim();
  if (trimmedName) return trimmedName;
  const trimmedLogin = login?.trim();
  if (trimmedLogin) return trimmedLogin;
  return fallback;
}

function eventToolAction(
  event: SharedSessionListEvent,
): SharedSessionLastAction | null {
  const payload = event.payload ?? {};
  const name = typeof payload.name === "string" ? payload.name : null;
  const text =
    typeof payload.text === "string"
      ? payload.text
      : typeof payload.output === "string"
        ? payload.output
        : null;
  if (name && text) return { tool: name, output: text };

  const agentEvent = payload.agentEvent;
  if (!agentEvent || typeof agentEvent !== "object") return null;
  const nested = (agentEvent as { payload?: Record<string, unknown> }).payload;
  const toolName =
    typeof nested?.toolName === "string" ? nested.toolName : null;
  const outputStream =
    typeof nested?.outputStream === "string" ? nested.outputStream : null;
  if (toolName && outputStream) {
    return { tool: toolName, output: outputStream };
  }
  return null;
}

export function lastCompletedSharedAction(
  session: Pick<SharedSessionListItem, "turns" | "events">,
): SharedSessionLastAction | null {
  for (const event of [...session.events].reverse()) {
    const action = eventToolAction(event);
    if (action) return action;
  }
  const completed = [...session.turns]
    .reverse()
    .find((turn) => turn.status === "completed" && turn.output);
  if (completed?.output) {
    return { tool: "agent output", output: completed.output };
  }
  return null;
}

function toProviderBoundaries(
  events: SharedSessionListEvent[],
): SharedSessionProviderBoundary[] {
  return events.flatMap((event) => {
    if (event.type !== PROVIDER_BOUNDARY_EVENT_TYPE) return [];
    const from =
      typeof event.payload?.from === "string" ? event.payload.from : null;
    const to = typeof event.payload?.to === "string" ? event.payload.to : null;
    if (!from || !to) return [];
    const afterTurnId =
      typeof event.payload?.afterTurnId === "string"
        ? event.payload.afterTurnId
        : (event.turnId ?? null);
    return [
      {
        id: event.id,
        from,
        to,
        fromLabel: capabilitiesForProvider(from).label,
        toLabel: capabilitiesForProvider(to).label,
        afterTurnId,
        label: providerSwitchLabel(from, to),
      },
    ];
  });
}

function providerForTurn(
  turn: SharedSessionListTurn,
  boundaries: Array<SharedSessionProviderBoundary & { createdAt: string }>,
  sessionProvider: string,
) {
  const created = iso(turn.createdAt);
  const later = boundaries.find((boundary) => boundary.createdAt > created);
  return later?.from ?? sessionProvider;
}

export function toSharedSessionView(
  session: SharedSessionListItem,
): SharedSessionView {
  const queuedTurns = session.turns.filter((turn) => turn.status === "queued");
  const queue = orderSharedSessionQueue(
    queuedTurns.map((turn, index) => ({
      id: turn.id,
      sessionId: session.id,
      authorId: turn.authorId,
      prompt: turn.prompt,
      queuePosition: index + 1,
      enqueuedAt: iso(turn.createdAt),
    })),
  );
  const running = session.turns.find((turn) => turn.status === "running");
  const transcriptTurns = session.turns.filter(
    (turn) =>
      turn.status === "completed" ||
      turn.status === "interrupted" ||
      turn.status === "failed",
  );
  const eventsByTurn = new Map<string, SharedSessionLastAction>();
  for (const event of session.events) {
    const action = eventToolAction(event);
    const turnId =
      event.turnId ??
      (typeof event.payload?.turnId === "string"
        ? event.payload.turnId
        : undefined);
    if (action && turnId) eventsByTurn.set(turnId, action);
  }
  const datedBoundaries = session.events.flatMap((event) => {
    if (event.type !== PROVIDER_BOUNDARY_EVENT_TYPE) return [];
    const [boundary] = toProviderBoundaries([event]);
    return boundary ? [{ ...boundary, createdAt: iso(event.createdAt) }] : [];
  });
  const providerBoundaries = toProviderBoundaries(session.events);

  return {
    session: sharedSessionSchema.parse({
      sessionId: session.id,
      workspaceId: session.workspaceId,
      ownerId: session.createdBy,
      worktreeId: session.worktreeId,
      provider: session.provider,
      model: session.model,
      state: session.status,
      activeTurnId: running?.id ?? null,
      streamCursor: session.events.length,
      queue,
    }),
    name: session.name,
    ownerName: displayMemberName(
      session.ownerName,
      session.ownerLogin,
      "Owner",
    ),
    activeTurnAuthorName: running
      ? displayMemberName(running.authorName, running.authorLogin)
      : null,
    worktreeName: session.worktreeName,
    model: session.model,
    attributedQueue: queue.map((entry) => {
      const turn = queuedTurns.find((item) => item.id === entry.id);
      return {
        ...entry,
        authorName: displayMemberName(turn?.authorName, turn?.authorLogin),
      };
    }),
    transcript: transcriptTurns.map((turn, index) => {
      const provider = providerForTurn(turn, datedBoundaries, session.provider);
      return {
        position: index + 1,
        turnId: turn.id,
        authorId: turn.authorId,
        authorName: displayMemberName(turn.authorName, turn.authorLogin),
        prompt: turn.prompt,
        status: turn.status as SharedSessionTranscriptTurn["status"],
        tool: eventsByTurn.get(turn.id)?.tool ?? null,
        output: turn.output ?? turn.lastError ?? null,
        provider,
        providerLabel: capabilitiesForProvider(provider).label,
      };
    }),
    lastCompletedAction: lastCompletedSharedAction(session),
    connectionBlocked: isProviderConnectionBlockMessage(session.lastError)
      ? (session.lastError ?? null)
      : null,
    providerEvents: toNormalizedProviderEvents(session),
    capabilities: capabilitiesForProvider(session.provider),
    availableProviders: listProviderCapabilities(session.provider),
    providerBoundaries,
  };
}
