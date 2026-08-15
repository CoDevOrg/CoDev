import type {
  SharedSessionListEvent,
  SharedSessionListItem,
} from "./shared-session-view";

export const NORMALIZED_PROVIDER_EVENT_KINDS = [
  "turn",
  "status",
  "output",
  "tool_call",
  "tool_result",
  "usage",
  "error",
  "cancellation",
] as const;

export type NormalizedProviderEventKind =
  (typeof NORMALIZED_PROVIDER_EVENT_KINDS)[number];

export type NormalizedProviderEvent = {
  id: string;
  kind: NormalizedProviderEventKind;
  label: string;
  detail: string;
  turnId: string | null;
};

const KIND_LABEL: Record<NormalizedProviderEventKind, string> = {
  turn: "Turn",
  status: "Status",
  output: "Output",
  tool_call: "Tool call",
  tool_result: "Tool result",
  usage: "Usage",
  error: "Error",
  cancellation: "Cancellation",
};

function payloadString(
  payload: Record<string, unknown> | null,
  key: string,
): string | null {
  const value = payload?.[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function eventTurnId(event: SharedSessionListEvent) {
  if (event.turnId) return event.turnId;
  const payloadTurn = event.payload?.turnId;
  return typeof payloadTurn === "string" ? payloadTurn : null;
}

function pushEvent(
  events: NormalizedProviderEvent[],
  seen: Set<string>,
  event: Omit<NormalizedProviderEvent, "label"> & { label?: string },
) {
  const key = `${event.kind}:${event.turnId ?? ""}:${event.detail}`;
  if (seen.has(key) || !event.detail.trim()) return;
  seen.add(key);
  events.push({
    ...event,
    label: event.label ?? KIND_LABEL[event.kind],
  });
}

export function toNormalizedProviderEvents(
  session: Pick<SharedSessionListItem, "turns" | "events">,
): NormalizedProviderEvent[] {
  const events: NormalizedProviderEvent[] = [];
  const seen = new Set<string>();

  for (const turn of session.turns) {
    if (turn.status === "queued") continue;
    pushEvent(events, seen, {
      id: `${turn.id}:turn`,
      kind: "turn",
      detail: turn.prompt,
      turnId: turn.id,
    });
    pushEvent(events, seen, {
      id: `${turn.id}:status`,
      kind: "status",
      detail: turn.status,
      turnId: turn.id,
    });
    if (turn.output) {
      pushEvent(events, seen, {
        id: `${turn.id}:output`,
        kind: "output",
        detail: turn.output,
        turnId: turn.id,
      });
    }
    if (turn.lastError) {
      pushEvent(events, seen, {
        id: `${turn.id}:error`,
        kind: "error",
        detail: turn.lastError,
        turnId: turn.id,
      });
    }
    if (turn.status === "interrupted") {
      pushEvent(events, seen, {
        id: `${turn.id}:cancellation`,
        kind: "cancellation",
        detail: "The controlled turn was cancelled.",
        turnId: turn.id,
      });
    }
  }

  for (const event of session.events) {
    const payload = event.payload ?? {};
    const turnId = eventTurnId(event);
    const tool =
      payloadString(payload, "name") ?? payloadString(payload, "toolName");
    const output =
      payloadString(payload, "text") ?? payloadString(payload, "output");
    const usage =
      typeof payload.inputTokens === "number" ||
      typeof payload.outputTokens === "number"
        ? `${Number(payload.inputTokens ?? 0)} in / ${Number(payload.outputTokens ?? 0)} out`
        : payloadString(payload, "usage");

    if (event.type === "tool.called" || event.type === "tool.started") {
      pushEvent(events, seen, {
        id: `${event.id}:tool_call`,
        kind: "tool_call",
        detail: tool ?? "workspace tool",
        turnId,
      });
    }
    if (
      event.type === "tool.completed" ||
      event.type === "tool.result" ||
      event.type === "tool.failed"
    ) {
      if (tool) {
        pushEvent(events, seen, {
          id: `${event.id}:tool_call`,
          kind: "tool_call",
          detail: tool,
          turnId,
        });
      }
      pushEvent(events, seen, {
        id: `${event.id}:tool_result`,
        kind: "tool_result",
        detail: output ?? tool ?? event.type,
        turnId,
      });
    }
    if (usage) {
      pushEvent(events, seen, {
        id: `${event.id}:usage`,
        kind: "usage",
        detail: usage,
        turnId,
      });
    }
    if (event.type.includes("error") || payloadString(payload, "error")) {
      pushEvent(events, seen, {
        id: `${event.id}:error`,
        kind: "error",
        detail: payloadString(payload, "error") ?? event.type,
        turnId,
      });
    }
  }

  return events;
}

export function fixtureProviderUsagePayload() {
  return { inputTokens: 12, outputTokens: 24, usage: "12 in / 24 out" };
}
