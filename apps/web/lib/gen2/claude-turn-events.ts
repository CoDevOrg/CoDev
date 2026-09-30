import type {
  Gen2TurnItem,
  Gen2TurnItemStatus,
  Gen2TurnState,
  Gen2TurnUsage,
} from "@codev/contracts";

import { toWorkspaceRelativePath } from "./turn-events";

/**
 * Reduces the NDJSON `claude -p --output-format stream-json --verbose` writes
 * into the same `Gen2TurnState` the Codex reducer produces.
 *
 * Same two properties as `reduceCodexTurn`, from a different source:
 *
 *  - **Idempotent.** Item ids are derived only from the stream itself: a
 *    `tool_use` block's own id, or `<message id>:<n>` where n counts the
 *    content blocks seen so far for that message (Claude emits one `assistant`
 *    event per block, all sharing a message id). Reducing a prefix and then
 *    the full text therefore yields the same ids in the same order.
 *  - **Total.** Unknown events, PTY noise, and a partial trailing line are
 *    skipped, never thrown.
 *
 * A tool's result arrives as a later `user` event keyed by `tool_use_id`, so
 * a tool card starts `running` and is finished in place.
 */

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** Event types only Claude's stream uses. Codex's are `thread.*`, `turn.*`,
 *  `item.*` and `error`, so the two never overlap. */
export const CLAUDE_STREAM_EVENT_TYPES: ReadonlySet<string> = new Set([
  "system",
  "assistant",
  "user",
  "result",
  "stream_event",
  "rate_limit_event",
]);

function toolItem(block: UnknownRecord, id: string): Gen2TurnItem {
  const name = asString(block.name);
  const input = asRecord(block.input) ?? {};
  const status: Gen2TurnItemStatus = "running";
  switch (name) {
    case "Bash":
      return {
        id,
        kind: "command",
        status,
        command: asString(input.command),
        output: "",
        exitCode: null,
      };
    case "Edit":
    case "MultiEdit":
    case "Write":
    case "NotebookEdit": {
      const path = toWorkspaceRelativePath(
        asString(input.file_path ?? input.notebook_path),
      );
      return {
        id,
        kind: "fileChange",
        status,
        changes: path ? [{ path, change: "modify" }] : [],
      };
    }
    case "TodoWrite": {
      const raw = Array.isArray(input.todos) ? input.todos : [];
      return {
        id,
        kind: "todoList",
        status,
        todos: raw.flatMap((entry) => {
          const record = asRecord(entry);
          if (!record) return [];
          return [
            {
              text: asString(record.content),
              completed: record.status === "completed",
            },
          ];
        }),
      };
    }
    case "WebSearch":
    case "WebFetch":
      return {
        id,
        kind: "webSearch",
        status,
        query: asString(input.query ?? input.url),
      };
    default: {
      // `mcp__<server>__<tool>`; anything else is one of Claude's own tools.
      const mcp = /^mcp__(.+?)__(.+)$/.exec(name);
      return {
        id,
        kind: "toolCall",
        status,
        server: mcp?.[1] ?? "claude",
        tool: mcp?.[2] ?? name,
      };
    }
  }
}

/** A tool result's `content` is a string or an array of `{type:"text"}`. */
function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .flatMap((part) => {
      const record = asRecord(part);
      return record && record.type === "text" ? [asString(record.text)] : [];
    })
    .join("\n");
}

function finishTool(
  item: Gen2TurnItem,
  content: string,
  failed: boolean,
): Gen2TurnItem {
  const status: Gen2TurnItemStatus = failed ? "failed" : "completed";
  if (item.kind === "command") {
    // Claude reports success or failure, not an exit code.
    return { ...item, status, output: content, exitCode: failed ? 1 : 0 };
  }
  return { ...item, status };
}

function toUsage(value: unknown): Gen2TurnUsage | null {
  const record = asRecord(value);
  if (!record) return null;
  return {
    inputTokens: asNumber(record.input_tokens),
    cachedInputTokens: asNumber(record.cache_read_input_tokens),
    outputTokens: asNumber(record.output_tokens),
  };
}

export function reduceClaudeTurn(output: string): Gen2TurnState {
  const items = new Map<string, Gen2TurnItem>();
  const blocksPerMessage = new Map<string, number>();
  let error: string | null = null;
  let usage: Gen2TurnUsage | null = null;
  let status: Gen2TurnState["status"] = "running";
  let finalText = "";
  let index = 0;

  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const event = asRecord(parsed);
    if (!event) continue;
    index += 1;
    const eventType = asString(event.type);

    if (eventType === "assistant" || eventType === "user") {
      // A sub-agent's own transcript would bury the parent's; its outcome
      // comes back through the parent's tool result.
      if (event.parent_tool_use_id) continue;
      const message = asRecord(event.message);
      const content = Array.isArray(message?.content) ? message.content : [];
      const messageId = asString(message?.id) || `msg-${index}`;
      for (const raw of content) {
        const block = asRecord(raw);
        if (!block) continue;
        const type = asString(block.type);

        if (eventType === "user") {
          if (type !== "tool_result") continue;
          const existing = items.get(asString(block.tool_use_id));
          if (!existing) continue;
          items.set(
            existing.id,
            finishTool(
              existing,
              resultText(block.content),
              block.is_error === true,
            ),
          );
          continue;
        }

        if (type === "tool_use") {
          const id = asString(block.id) || `tool-${index}`;
          items.set(id, toolItem(block, id));
          continue;
        }
        if (type !== "text" && type !== "thinking") continue;
        const count = blocksPerMessage.get(messageId) ?? 0;
        blocksPerMessage.set(messageId, count + 1);
        const id = `${messageId}:${count}`;
        items.set(
          id,
          type === "text"
            ? {
                id,
                kind: "message",
                status: "completed",
                text: asString(block.text),
              }
            : {
                id,
                kind: "reasoning",
                status: "completed",
                text: asString(block.thinking),
              },
        );
      }
      continue;
    }

    if (eventType === "result") {
      usage = toUsage(event.usage) ?? usage;
      finalText = asString(event.result).trim();
      const failed = event.is_error === true || event.subtype !== "success";
      status = failed ? "failed" : "completed";
      if (failed) {
        const detail =
          finalText ||
          (Array.isArray(event.errors)
            ? event.errors.map(asString).filter(Boolean).join("; ")
            : "") ||
          asString(event.subtype).replace(/_/g, " ");
        if (detail.trim()) error = detail.trim();
      }
    }
  }

  const ordered = [...items.values()];
  const reply = ordered
    .filter((item) => item.kind === "message" && item.text.trim())
    .at(-1);

  return {
    items: ordered,
    reply:
      reply?.kind === "message"
        ? reply.text.trim()
        : status === "completed"
          ? finalText
          : "",
    error,
    usage,
    status,
  };
}
