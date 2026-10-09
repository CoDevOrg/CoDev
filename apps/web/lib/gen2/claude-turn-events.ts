import type {
  Gen2TurnItem,
  Gen2TurnState,
  Gen2TurnUsage,
} from "@codev/contracts";

import {
  asRecord,
  asString,
  finishTool,
  resultText,
  toolItem,
} from "./claude-tool-items";

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

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
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
