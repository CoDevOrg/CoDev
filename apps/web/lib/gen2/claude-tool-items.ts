import type { Gen2TurnItem, Gen2TurnItemStatus } from "@codev/contracts";

import { toWorkspaceRelativePath } from "./turn-events";

/**
 * Claude `tool_use` and `tool_result` content blocks as activity cards. The
 * live stream reducer and the transcript importer read the same blocks.
 */

type UnknownRecord = Record<string, unknown>;

export function asRecord(value: unknown): UnknownRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

export function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function toolItem(
  block: UnknownRecord,
  id: string,
  toPath: (path: string) => string = toWorkspaceRelativePath,
): Gen2TurnItem {
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
      const path = toPath(asString(input.file_path ?? input.notebook_path));
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
export function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .flatMap((part) => {
      const record = asRecord(part);
      return record && record.type === "text" ? [asString(record.text)] : [];
    })
    .join("\n");
}

export function finishTool(
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
