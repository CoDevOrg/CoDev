import type { AgentEvent } from "@codev/shared-types";

export type AgentChatTurn = {
  id: string;
  prompt: string;
  status: string;
  output: string | null;
  lastError: string | null;
  createdAt?: string | Date | null;
};

export type AgentChatEvent = {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  createdAt?: string | Date | null;
};

export type AgentChatSession = {
  id: string;
  name: string;
  turns: AgentChatTurn[];
  events: AgentChatEvent[];
};

export type ChatToolCall = {
  id: string;
  name: string;
  status: "running" | "completed" | "failed";
  detail?: string;
};

export type ChatItem =
  | { kind: "user"; id: string; text: string }
  | { kind: "assistant"; id: string; text: string }
  | { kind: "tools"; id: string; tools: ChatToolCall[] }
  | {
      kind: "comment";
      id: string;
      text: string;
      author: string;
      filePath?: string;
      lineNumber?: number;
    }
  | { kind: "error"; id: string; text: string };

/** Convert the binary workspace journal back to the chat event shape used by the UI. */
export function mapAgentEventToChatEvent(event: AgentEvent): AgentChatEvent {
  switch (event.type) {
    case "USER_PROMPT":
      return {
        id: event.id,
        type: "turn.started",
        payload: { prompt: event.payload.promptText ?? "" },
        createdAt: new Date(event.timestamp),
      };
    case "AGENT_THOUGHT":
      return {
        id: event.id,
        type: "agent.output",
        payload: { text: event.payload.outputStream ?? "" },
        createdAt: new Date(event.timestamp),
      };
    case "TOOL_CALL_INIT":
      return {
        id: event.id,
        type: "tool.called",
        payload: {
          name: event.payload.toolName ?? "workspace tool",
          callId: event.payload.toolCallId ?? event.id,
          arguments: event.payload.metadata?.arguments ?? null,
        },
        createdAt: new Date(event.timestamp),
      };
    case "TOOL_CALL_RESULT":
      return {
        id: event.id,
        type:
          event.payload.status === "failed" ? "tool.failed" : "tool.completed",
        payload: {
          name: event.payload.toolName ?? "workspace tool",
          callId: event.payload.toolCallId ?? event.id,
          ...(event.payload.outputStream
            ? { output: event.payload.outputStream }
            : {}),
          ...(event.payload.error ? { error: event.payload.error } : {}),
        },
        createdAt: new Date(event.timestamp),
      };
    case "FILE_DIFF_PROPOSED":
      return {
        id: event.id,
        type: "tool.completed",
        payload: {
          name: "proposed diff",
          output: event.payload.diffContent ?? "",
          filePath: event.payload.filePath ?? "",
        },
        createdAt: new Date(event.timestamp),
      };
    case "COMMENT_ADDED": {
      const metadata = event.payload.metadata;
      const lineNumber =
        typeof metadata === "object" && metadata !== null
          ? (metadata as Record<string, unknown>).lineNumber
          : undefined;
      return {
        id: event.id,
        type: "comment.added",
        payload: {
          text: event.payload.commentText ?? "",
          author: event.actor.userName,
          ...(event.payload.filePath
            ? { filePath: event.payload.filePath }
            : {}),
          ...(typeof lineNumber === "number" ? { lineNumber } : {}),
        },
        createdAt: new Date(event.timestamp),
      };
    }
    case "INTERVENTION_PAUSE":
      return {
        id: event.id,
        type: "turn.interrupted",
        payload: event.payload,
        createdAt: new Date(event.timestamp),
      };
    case "TERMINAL_EXEC_START":
      return {
        id: event.id,
        type: "tool.called",
        payload: {
          name: "terminal",
          callId: event.id,
        },
        createdAt: new Date(event.timestamp),
      };
    case "TERMINAL_EXEC_END":
      return {
        id: event.id,
        type:
          event.payload.status === "failed" ? "tool.failed" : "tool.completed",
        payload: {
          name: "terminal",
          callId: event.id,
          output: event.payload.outputStream,
          error: event.payload.error,
        },
        createdAt: new Date(event.timestamp),
      };
  }
}

function timestamp(value: string | Date | null | undefined, fallback: number) {
  if (value == null) return fallback;
  const ms = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(ms) ? ms : fallback;
}

function payloadString(
  payload: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = payload[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function flushTools(
  items: ChatItem[],
  pending: ChatToolCall[],
  groupId: string,
) {
  if (pending.length === 0) return;
  items.push({
    kind: "tools",
    id: `tools:${groupId}`,
    tools: pending.map((tool) => ({ ...tool })),
  });
  pending.length = 0;
}

/**
 * Map a listAgentSessions session (turns + events) into chronological chat items.
 * - turns → user bubbles
 * - agent.output → assistant bubbles
 * - tool.* → collapsed tool trails
 */
export function mapSessionToChatItems(session: AgentChatSession): ChatItem[] {
  type Node =
    | { at: number; seq: number; kind: "turn"; turn: AgentChatTurn }
    | { at: number; seq: number; kind: "event"; event: AgentChatEvent };

  const nodes: Node[] = [
    ...session.turns.map((turn, index) => ({
      at: timestamp(turn.createdAt, index),
      seq: index,
      kind: "turn" as const,
      turn,
    })),
    ...session.events.map((event, index) => ({
      at: timestamp(event.createdAt, 10_000 + index),
      seq: 10_000 + index,
      kind: "event" as const,
      event,
    })),
  ].sort((left, right) => left.at - right.at || left.seq - right.seq);

  const items: ChatItem[] = [];
  const pendingTools: ChatToolCall[] = [];
  let toolsGroupId = "";
  const assistantTexts = new Set<string>();

  for (const node of nodes) {
    if (node.kind === "turn") {
      flushTools(items, pendingTools, toolsGroupId);
      items.push({
        kind: "user",
        id: `turn:${node.turn.id}`,
        text: node.turn.prompt,
      });
      if (node.turn.lastError) {
        items.push({
          kind: "error",
          id: `turn-error:${node.turn.id}`,
          text: node.turn.lastError,
        });
      }
      continue;
    }

    const { event } = node;
    if (
      event.type === "turn.started" ||
      event.type === "turn.completed" ||
      event.type === "turn.interrupted"
    ) {
      continue;
    }

    if (
      event.type === "tool.called" ||
      event.type === "tool.completed" ||
      event.type === "tool.failed"
    ) {
      const name = payloadString(event.payload, "name") ?? "tool";
      if (pendingTools.length === 0) toolsGroupId = event.id;

      if (event.type === "tool.called") {
        pendingTools.push({
          id: event.id,
          name,
          status: "running",
        });
        continue;
      }

      const status = event.type === "tool.completed" ? "completed" : "failed";
      const detail =
        payloadString(event.payload, "output") ??
        payloadString(event.payload, "error");
      const existing = [...pendingTools]
        .reverse()
        .find((tool) => tool.name === name && tool.status === "running");
      if (existing) {
        existing.status = status;
        if (detail) existing.detail = detail;
      } else {
        pendingTools.push({
          id: event.id,
          name,
          status,
          ...(detail ? { detail } : {}),
        });
      }
      continue;
    }

    if (event.type === "agent.output") {
      flushTools(items, pendingTools, toolsGroupId);
      const text = payloadString(event.payload, "text");
      if (!text || assistantTexts.has(text)) continue;
      assistantTexts.add(text);
      items.push({
        kind: "assistant",
        id: `assistant:${event.id}`,
        text,
      });
      continue;
    }

    if (event.type === "comment.added") {
      flushTools(items, pendingTools, toolsGroupId);
      const text = payloadString(event.payload, "text");
      if (!text) continue;
      const filePath = payloadString(event.payload, "filePath");
      const lineNumber = event.payload.lineNumber;
      items.push({
        kind: "comment",
        id: `comment:${event.id}`,
        text,
        author: payloadString(event.payload, "author") ?? "Reviewer",
        ...(filePath ? { filePath } : {}),
        ...(typeof lineNumber === "number" ? { lineNumber } : {}),
      });
      continue;
    }
  }

  flushTools(items, pendingTools, toolsGroupId || "end");

  // Fallback: completed turns with stored output but no assistant bubble yet.
  for (const turn of session.turns) {
    if (!turn.output) continue;
    const userIndex = items.findIndex(
      (item) => item.kind === "user" && item.id === `turn:${turn.id}`,
    );
    if (userIndex < 0) continue;
    let hasAssistant = false;
    for (let index = userIndex + 1; index < items.length; index += 1) {
      const item = items[index];
      if (item?.kind === "user") break;
      if (item?.kind === "assistant") {
        hasAssistant = true;
        break;
      }
    }
    if (hasAssistant || assistantTexts.has(turn.output)) continue;
    let insertAt = userIndex + 1;
    while (insertAt < items.length && items[insertAt]?.kind !== "user") {
      insertAt += 1;
    }
    items.splice(insertAt, 0, {
      kind: "assistant",
      id: `turn-output:${turn.id}`,
      text: turn.output,
    });
    assistantTexts.add(turn.output);
  }

  return items;
}
