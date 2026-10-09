import type { Gen2TurnItem } from "@codev/contracts";

import {
  CODEX_TOOL_CALL,
  readCodexToolCall,
  readCodexToolOutput,
} from "./session-import-codex-responses";
import {
  asRecord,
  asString,
  codexChangeKind,
  codexCommandText,
  codexContentText,
  codexRequestText,
  type CodexLine,
} from "./session-import-codex-text";
import {
  SessionImportError,
  SessionTranscript,
  sessionRelativePath,
  toIsoOrNull,
  type ParsedAgentSession,
} from "./session-import-transcript";

/**
 * Reads a Codex rollout (`~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`).
 *
 * Line one is the `session_meta` header with the session id Codex resumes by.
 * Current Codex records each finished thread item as an `item_completed`
 * event -- the prompt without the injected IDE and AGENTS.md context, agent
 * notes and replies, commands, file changes -- which is what a chat shows.
 * Older rollouts lack some of those, so each part falls back on its own:
 * prompts to `user_message` events, then to `response_item` messages minus
 * injected context; tools to `response_item` calls.
 */

const SESSION_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INJECTED_CONTEXT = /^(?:<[a-z_]+>|# AGENTS\.md instructions)/;
const TOOL_ITEMS = ["CommandExecution", "FileChange", "McpToolCall"];

function itemCard(
  item: Record<string, unknown>,
  toPath: (path: string) => string,
): Gen2TurnItem | null {
  const id = asString(item.id);
  if (!id) return null;
  const failed = /fail|declin|error/i.test(asString(item.status));
  const status = failed ? ("failed" as const) : ("completed" as const);
  switch (item.type) {
    case "Reasoning": {
      const summary = Array.isArray(item.summary_text) ? item.summary_text : [];
      const text = summary.map(asString).join("\n\n").trim();
      return text ? { id, kind: "reasoning", status, text } : null;
    }
    case "CommandExecution": {
      const exitCode =
        typeof item.exit_code === "number" ? item.exit_code : null;
      return {
        id,
        kind: "command",
        status: failed || (exitCode ?? 0) !== 0 ? "failed" : "completed",
        command: codexCommandText(item.command),
        output: asString(item.aggregated_output),
        exitCode,
      };
    }
    case "FileChange": {
      const changes = Object.entries(asRecord(item.changes) ?? {}).map(
        ([path, change]) => ({
          path: toPath(path),
          change: codexChangeKind(asString(asRecord(change)?.type)),
        }),
      );
      return { id, kind: "fileChange", status, changes };
    }
    case "McpToolCall":
      return {
        id,
        kind: "toolCall",
        status,
        server: asString(item.server),
        tool: asString(item.tool),
      };
    case "Extension":
      return asString(item.kind).includes("search")
        ? { id, kind: "webSearch", status, query: asString(item.query) }
        : null;
    default:
      return null;
  }
}

function readHeader(lines: CodexLine[]) {
  const meta = lines[0]?.type === "session_meta" ? lines[0].payload : null;
  const id = asString(meta?.id);
  if (!meta || !SESSION_ID.test(id)) {
    throw new SessionImportError(
      "This doesn't look like a Codex rollout. Choose a rollout-*.jsonl file from ~/.codex/sessions.",
    );
  }
  const git = asRecord(meta.git);
  return {
    nativeSessionId: id,
    startedAt: toIsoOrNull(meta.timestamp),
    cwd: asString(meta.cwd) || null,
    repo: {
      remote: asString(git?.repository_url) || null,
      branch: asString(git?.branch) || null,
      commit: asString(git?.commit_hash) || null,
    },
  };
}

function toLines(records: unknown[]): CodexLine[] {
  return records.flatMap((record) => {
    const line = asRecord(record);
    const payload = asRecord(line?.payload);
    if (!line || !payload) return [];
    const timestamp = toIsoOrNull(line.timestamp);
    return [{ type: asString(line.type), timestamp, payload }];
  });
}

const completedItem = (line: CodexLine) =>
  line.type === "event_msg" && line.payload.type === "item_completed"
    ? asRecord(line.payload.item)
    : null;

export function parseCodexSession(records: unknown[]): ParsedAgentSession {
  const lines = toLines(records);
  const header = readHeader(lines);
  const itemTypes = new Set(
    lines.map((line) => asString(completedItem(line)?.type)),
  );
  const messagesFrom = itemTypes.has("UserMessage")
    ? "items"
    : lines.some((line) => line.payload.type === "user_message")
      ? "events"
      : "responses";
  const toolsFromItems = TOOL_ITEMS.some((type) => itemTypes.has(type));
  // A session can move between checkouts; paths show relative to any of them.
  const roots = new Set(
    lines.map((line) =>
      line.type === "session_meta" || line.type === "turn_context"
        ? asString(line.payload.cwd)
        : asString(completedItem(line)?.cwd),
    ),
  );
  const toPath = (path: string) => sessionRelativePath(path, [...roots]);

  const transcript = new SessionTranscript();
  for (const line of lines) {
    const { type, payload, timestamp: at } = line;
    const kind = asString(payload.type);
    const item = completedItem(line);
    if (item) {
      const text = codexContentText(item.content);
      if (item.type === "UserMessage" && messagesFrom === "items") {
        transcript.user(codexRequestText(text) || "(image)", at);
      } else if (item.type === "AgentMessage" && messagesFrom === "items") {
        if (item.phase !== "commentary") transcript.reply(text, at);
        else
          transcript.item(
            {
              id: asString(item.id),
              kind: "message",
              status: "completed",
              text,
            },
            at,
          );
      } else if (item.type === "Reasoning" || toolsFromItems) {
        const card = itemCard(item, toPath);
        if (card) transcript.item(card, at);
      }
    } else if (messagesFrom === "events" && type === "event_msg") {
      const text = asString(payload.message);
      if (kind === "user_message") transcript.user(codexRequestText(text), at);
      if (kind === "agent_message") transcript.reply(text, at);
    } else if (
      messagesFrom === "responses" &&
      type === "response_item" &&
      kind === "message"
    ) {
      const text = codexContentText(payload.content);
      if (payload.role === "assistant") transcript.reply(text, at);
      else if (payload.role === "user" && !INJECTED_CONTEXT.test(text.trim()))
        transcript.user(codexRequestText(text), at);
    } else if (!toolsFromItems && type === "response_item") {
      if (CODEX_TOOL_CALL.test(kind))
        readCodexToolCall(transcript, payload, at, toPath);
      else if (kind.endsWith("_call_output"))
        readCodexToolOutput(transcript, payload);
    }
  }
  return { ...header, title: null, messages: transcript.finish() };
}
