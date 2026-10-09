import {
  asRecord,
  asString,
  finishTool,
  resultText,
  toolItem,
} from "./claude-tool-items";
import {
  SessionImportError,
  SessionTranscript,
  sessionRelativePath,
  toIsoOrNull,
  type ParsedAgentSession,
} from "./session-import-transcript";

/**
 * Reads a Claude Code transcript (`~/.claude/projects/<dir>/<id>.jsonl`).
 *
 * The file is a tree: every entry names its `parentUuid`, and a rewound or
 * edited prompt leaves the abandoned branch in place. The conversation is the
 * path from the last main-thread entry back to the root; a compaction boundary
 * links across with `logicalParentUuid`. Sub-agent (`isSidechain`) entries,
 * injected meta prompts, local slash-command echoes, and compaction summaries
 * are not part of what the member and the agent said.
 */

type Entry = Record<string, unknown>;

const SESSION_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LOCAL_COMMAND = /^\s*(?:<command-|<local-command-|<bash-|Caveat:)/;

function conversationPath(entries: Entry[]): Entry[] {
  const byId = new Map(
    entries.flatMap((entry) => {
      const id = asString(entry.uuid);
      return id ? [[id, entry] as const] : [];
    }),
  );
  const leaf = entries.findLast(
    (entry) =>
      (entry.type === "user" || entry.type === "assistant") &&
      !entry.isSidechain &&
      asString(entry.uuid),
  );
  const path: Entry[] = [];
  const seen = new Set<string>();
  for (let entry = leaf; entry; ) {
    const id = asString(entry.uuid);
    if (seen.has(id)) break;
    seen.add(id);
    path.push(entry);
    const parent =
      asString(entry.parentUuid) || asString(entry.logicalParentUuid);
    entry = parent ? byId.get(parent) : undefined;
  }
  return path.reverse();
}

function readUser(transcript: SessionTranscript, entry: Entry) {
  if (entry.isMeta || entry.isCompactSummary) return;
  const at = toIsoOrNull(entry.timestamp);
  const content = asRecord(entry.message)?.content;
  if (typeof content === "string") {
    if (!LOCAL_COMMAND.test(content)) transcript.user(content, at);
    return;
  }
  const blocks = (Array.isArray(content) ? content : []).flatMap((block) => {
    const record = asRecord(block);
    return record ? [record] : [];
  });
  for (const block of blocks.filter((b) => b.type === "tool_result")) {
    transcript.update(asString(block.tool_use_id), (item) =>
      finishTool(item, resultText(block.content), block.is_error === true),
    );
  }
  const text = blocks
    .filter((block) => block.type === "text")
    .map((block) => asString(block.text))
    .join("\n")
    .trim();
  const hasImage = blocks.some((block) => block.type === "image");
  if (text && !LOCAL_COMMAND.test(text)) transcript.user(text, at);
  else if (hasImage) transcript.user("(image)", at);
}

function readAssistant(
  transcript: SessionTranscript,
  entry: Entry,
  roots: string[],
) {
  const at = toIsoOrNull(entry.timestamp);
  const message = asRecord(entry.message);
  const messageId = asString(message?.id) || asString(entry.uuid);
  const blocks = Array.isArray(message?.content) ? message.content : [];
  blocks.forEach((raw, index) => {
    const block = asRecord(raw);
    if (!block) return;
    // One API message is split across entries, one block each.
    const id = `${messageId}:${asString(entry.uuid)}:${index}`;
    if (block.type === "tool_use") {
      const toolId = asString(block.id) || id;
      const card = toolItem(block, toolId, (path) =>
        sessionRelativePath(path, roots),
      );
      transcript.item({ ...card, status: "completed" }, at);
    } else if (block.type === "text" && asString(block.text).trim()) {
      const text = asString(block.text);
      transcript.item({ id, kind: "message", status: "completed", text }, at);
    } else if (block.type === "thinking" && asString(block.thinking).trim()) {
      const text = asString(block.thinking);
      transcript.item({ id, kind: "reasoning", status: "completed", text }, at);
    }
  });
}

export function parseClaudeSession(records: unknown[]): ParsedAgentSession {
  const entries = records.flatMap((record) => {
    const entry = asRecord(record);
    return entry ? [entry] : [];
  });
  const first = entries.find((entry) => asString(entry.cwd));
  const nativeSessionId = asString(
    entries.find((entry) => asString(entry.sessionId))?.sessionId,
  );
  if (!SESSION_ID.test(nativeSessionId)) {
    throw new SessionImportError(
      "This doesn't look like a Claude Code transcript. Choose a <session id>.jsonl file from ~/.claude/projects.",
    );
  }
  const cwd = asString(first?.cwd) || null;
  const roots = [...new Set(entries.map((entry) => asString(entry.cwd)))];
  const transcript = new SessionTranscript();
  for (const entry of conversationPath(entries)) {
    if (entry.isSidechain) continue;
    if (entry.type === "user") readUser(transcript, entry);
    if (entry.type === "assistant") readAssistant(transcript, entry, roots);
  }
  const title = entries.findLast((entry) => entry.type === "custom-title");
  const conversation = entries.filter((entry) => entry.timestamp);
  return {
    nativeSessionId,
    startedAt: toIsoOrNull(conversation[0]?.timestamp),
    cwd,
    repo: {
      remote: null,
      branch: asString(first?.gitBranch) || null,
      commit: null,
    },
    title: asString(title?.customTitle) || null,
    messages: transcript.finish(),
  };
}
