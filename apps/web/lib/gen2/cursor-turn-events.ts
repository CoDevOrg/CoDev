import type { Gen2TurnItem, Gen2TurnState } from "@codev/contracts";

import { toWorkspaceRelativePath } from "./turn-events";

type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as RecordValue)
    : {};
const text = (value: unknown) => (typeof value === "string" ? value : "");

function toolItem(event: RecordValue): Gen2TurnItem {
  const id = text(event.call_id);
  const call = record(event.tool_call);
  const [name = "unknown", value] = Object.entries(call)[0] ?? [];
  const tool = record(value);
  const args = record(tool.args);
  const result = record(tool.result);
  const success = record(result.success);
  const status = result.error
    ? "failed"
    : event.subtype === "completed"
      ? "completed"
      : "running";
  if (name === "shellToolCall") {
    return {
      id,
      kind: "command",
      status,
      command: text(args.command),
      output: text(success.output ?? success.stdout),
      exitCode: typeof success.exitCode === "number" ? success.exitCode : null,
    };
  }
  if (["writeToolCall", "editToolCall", "deleteToolCall"].includes(name)) {
    return fileItem(id, name, args, status);
  }
  return {
    id,
    kind: "toolCall",
    status,
    server: "cursor",
    tool: text(record(call.function).name) || name,
  };
}

function fileItem(
  id: string,
  name: string,
  args: RecordValue,
  status: Gen2TurnItem["status"],
): Gen2TurnItem {
  const path = toWorkspaceRelativePath(text(args.path));
  return {
    id,
    kind: "fileChange",
    status,
    changes: path
      ? [{ path, change: name === "deleteToolCall" ? "delete" : "modify" }]
      : [],
  };
}

function assistantText(event: RecordValue): string {
  const content = record(event.message).content;
  return Array.isArray(content)
    ? content.map((part) => text(record(part).text)).join("")
    : "";
}

function parseEvent(line: string): RecordValue {
  try {
    return record(JSON.parse(line));
  } catch {
    return {};
  }
}

/** Cursor's complete-message stream, reduced again on each accumulated poll. */
export function reduceCursorTurn(output: string): Gen2TurnState {
  const items = new Map<string, Gen2TurnItem>();
  let reply = "";
  let status: Gen2TurnState["status"] = "running";
  let error: string | null = null;
  let messageIndex = 0;
  for (const line of output.split(/\r?\n/)) {
    const event = parseEvent(line.trim());
    if (event.type === "assistant") {
      const message = assistantText(event);
      if (message) {
        const id = `cursor-message-${messageIndex++}`;
        items.set(id, {
          id,
          kind: "message",
          status: "completed",
          text: message,
        });
        reply += message;
      }
    }
    if (event.type === "tool_call" && text(event.call_id)) {
      const item = toolItem(event);
      items.set(item.id, item);
    }
    if (event.type === "result") {
      status =
        event.is_error || event.subtype !== "success" ? "failed" : "completed";
      if (status === "failed")
        error = text(event.result) || "Cursor could not complete this turn.";
      else reply = text(event.result) || reply;
    }
    if (event.type === "error") {
      status = "failed";
      error = text(event.message) || "Cursor could not complete this turn.";
    }
  }
  if (
    status === "running" &&
    /^ActionRequiredError: .*You're out of usage\./m.test(output)
  ) {
    status = "failed";
    error =
      "Your Cursor account is out of usage for this model. Choose Auto or increase your Cursor usage limit.";
  }
  return { items: [...items.values()], reply, status, error, usage: null };
}
