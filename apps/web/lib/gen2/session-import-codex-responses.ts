import {
  asRecord,
  asString,
  codexChangeKind,
  codexCommandText,
  codexContentText,
} from "./session-import-codex-text";
import type { SessionTranscript } from "./session-import-transcript";

/**
 * Tool calls as older Codex rollouts record them: `response_item` function
 * calls, paired with their outputs by `call_id`. Current rollouts also carry
 * finished `item_completed` items, which the parser prefers when present.
 */

const SHELL_TOOLS = new Set(["shell", "exec_command", "container.exec"]);
const PATCH_FILE = /^\*\*\* (Add|Update|Delete) File: (.+)$/gm;

export const CODEX_TOOL_CALL =
  /^(?:function_call|custom_tool_call|local_shell_call)$/;

function parseArguments(raw: unknown): Record<string, unknown> {
  const record = asRecord(raw);
  if (record) return record;
  try {
    return asRecord(JSON.parse(asString(raw))) ?? {};
  } catch {
    return {};
  }
}

export function readCodexToolCall(
  transcript: SessionTranscript,
  call: Record<string, unknown>,
  at: string | null,
  toPath: (path: string) => string,
) {
  const id = asString(call.call_id) || asString(call.id);
  if (!id) return;
  const name = asString(call.name);
  const args = parseArguments(call.arguments ?? call.action);
  const status = "completed" as const;
  if (call.type === "local_shell_call" || SHELL_TOOLS.has(name)) {
    const command = codexCommandText(args.command ?? args.cmd);
    transcript.item(
      { id, kind: "command", status, command, output: "", exitCode: null },
      at,
    );
  } else if (name === "update_plan") {
    const plan = Array.isArray(args.plan) ? args.plan : [];
    const todos = plan.map((step) => ({
      text: asString(asRecord(step)?.step),
      completed: asRecord(step)?.status === "completed",
    }));
    transcript.item({ id, kind: "todoList", status, todos }, at);
  } else if (name === "apply_patch") {
    const patch = asString(call.input) || asString(args.input);
    const changes = [...patch.matchAll(PATCH_FILE)].map((match) => ({
      path: toPath((match[2] ?? "").trim()),
      change: codexChangeKind(match[1] ?? ""),
    }));
    transcript.item({ id, kind: "fileChange", status, changes }, at);
  } else if (name) {
    transcript.item(
      { id, kind: "toolCall", status, server: "codex", tool: name },
      at,
    );
  }
}

/** Old outputs are a JSON string `{output, metadata: {exit_code}}`. */
export function readCodexToolOutput(
  transcript: SessionTranscript,
  result: Record<string, unknown>,
) {
  const parsed = parseArguments(result.output);
  const exit = asRecord(parsed.metadata)?.exit_code;
  const exitCode = typeof exit === "number" ? exit : null;
  const output =
    typeof parsed.output === "string"
      ? parsed.output
      : asString(result.output) || codexContentText(result.output);
  const status = (exitCode ?? 0) === 0 ? "completed" : "failed";
  transcript.update(asString(result.call_id), (item) =>
    item.kind === "command" ? { ...item, output, exitCode, status } : item,
  );
}
