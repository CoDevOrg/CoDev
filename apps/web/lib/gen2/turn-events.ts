import type {
  Gen2TurnItem,
  Gen2TurnItemStatus,
  Gen2TurnState,
  Gen2TurnUsage,
} from "@codev/contracts";

/**
 * Reduces the NDJSON `codex exec --json` writes to stdout into the activity
 * a turn should render.
 *
 * Two properties matter and both come from Codex giving every item a stable
 * `id` across `item.started` -> `item.updated` -> `item.completed`:
 *
 *  - **Idempotent.** The client re-decodes the whole accumulated byte stream
 *    on every poll, so this runs against a growing prefix of the same text
 *    over and over. Keying by `item.id` means reducing a prefix and then the
 *    full stream yields the same items in the same order with the same ids,
 *    so React keys never churn and cards never duplicate.
 *  - **Total.** Anything unrecognised is skipped rather than thrown: PTY
 *    noise around the JSON, the partial trailing line while a poll is still
 *    in flight, and item types a newer Codex adds that we have no card for.
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

function asNumberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function statusFor(eventType: string, raw: unknown): Gen2TurnItemStatus {
  const declared = asString(raw);
  if (declared === "failed" || declared === "error") return "failed";
  if (eventType === "item.completed") return "completed";
  if (declared === "completed") return "completed";
  return "running";
}

/**
 * Codex reports absolute guest paths (`/workspace/src/a.ts`). The rest of the
 * workbench addresses files relative to the workspace root, so normalise here
 * and a `fileChange` card can link straight into the editor.
 */
export function toWorkspaceRelativePath(path: string): string {
  return path
    .replace(/^\/workspace\/?/, "")
    .replace(/^\.\//, "")
    .trim();
}

function fileChangeKind(raw: unknown): "add" | "modify" | "delete" {
  const value = asString(raw).toLowerCase();
  if (value === "add" || value === "added" || value === "create") return "add";
  if (value === "delete" || value === "deleted" || value === "remove") {
    return "delete";
  }
  return "modify";
}

/** One Codex `item` object -> the card we render, or null if we have none. */
function toTurnItem(
  item: UnknownRecord,
  eventType: string,
  fallbackId: string,
): Gen2TurnItem | null {
  const id = asString(item.id) || fallbackId;
  const status = statusFor(eventType, item.status);
  switch (asString(item.type)) {
    case "reasoning":
      return { id, kind: "reasoning", status, text: asString(item.text) };
    case "agent_message":
      return { id, kind: "message", status, text: asString(item.text) };
    case "command_execution":
      return {
        id,
        kind: "command",
        status,
        command: asString(item.command),
        output: asString(item.aggregated_output ?? item.output),
        exitCode: asNumberOrNull(item.exit_code),
      };
    case "file_change": {
      const raw = Array.isArray(item.changes) ? item.changes : [];
      const changes = raw.flatMap((entry) => {
        const record = asRecord(entry);
        if (!record) return [];
        const path = toWorkspaceRelativePath(asString(record.path));
        if (!path) return [];
        return [{ path, change: fileChangeKind(record.kind) }];
      });
      return { id, kind: "fileChange", status, changes };
    }
    case "todo_list": {
      const raw = Array.isArray(item.items) ? item.items : [];
      const todos = raw.flatMap((entry) => {
        const record = asRecord(entry);
        if (!record) return [];
        return [
          { text: asString(record.text), completed: record.completed === true },
        ];
      });
      return { id, kind: "todoList", status, todos };
    }
    case "web_search":
      return { id, kind: "webSearch", status, query: asString(item.query) };
    case "mcp_tool_call":
      return {
        id,
        kind: "toolCall",
        status,
        server: asString(item.server),
        tool: asString(item.tool),
      };
    default:
      return null;
  }
}

function toUsage(value: unknown): Gen2TurnUsage | null {
  const record = asRecord(value);
  if (!record) return null;
  const input = asNumberOrNull(record.input_tokens) ?? 0;
  const cached = asNumberOrNull(record.cached_input_tokens) ?? 0;
  const output = asNumberOrNull(record.output_tokens) ?? 0;
  return {
    inputTokens: input,
    cachedInputTokens: cached,
    outputTokens: output,
  };
}

export function reduceCodexTurn(output: string): Gen2TurnState {
  // Insertion-ordered: a Map preserves first-seen order, so an item that is
  // updated late keeps its original position in the transcript.
  const items = new Map<string, Gen2TurnItem>();
  let error: string | null = null;
  let usage: Gen2TurnUsage | null = null;
  let status: Gen2TurnState["status"] = "running";
  let index = 0;

  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      // PTY noise, or the trailing line of a stream still being written.
      continue;
    }
    const event = asRecord(parsed);
    if (!event) continue;
    const eventType = asString(event.type);
    index += 1;

    if (
      eventType === "item.started" ||
      eventType === "item.updated" ||
      eventType === "item.completed"
    ) {
      const item = asRecord(event.item);
      if (!item) continue;
      const turnItem = toTurnItem(item, eventType, `item-${index}`);
      if (turnItem) items.set(turnItem.id, turnItem);
      continue;
    }

    if (eventType === "turn.completed") {
      usage = toUsage(event.usage) ?? usage;
      status = "completed";
      continue;
    }

    if (eventType === "turn.failed" || eventType === "error") {
      const detail =
        asString(asRecord(event.error)?.message) || asString(event.message);
      if (detail.trim()) error = detail.trim();
      status = "failed";
    }
  }

  const ordered = [...items.values()];
  const reply = ordered
    .filter((item) => item.kind === "message" && item.text.trim())
    .at(-1);

  return {
    items: ordered,
    reply: reply?.kind === "message" ? reply.text.trim() : "",
    error,
    usage,
    status,
  };
}
