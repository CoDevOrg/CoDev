import type { Gen2SessionImportMessage, Gen2TurnItem } from "@codev/contracts";

/**
 * Groups a local agent session into chat messages the way a Gen 2 chat stores
 * them: each user prompt is one message, and everything the agent did until
 * its reply (commands, edits, interim notes) becomes that reply's activity
 * cards. Both the Codex and Claude parsers feed this.
 */

export type ParsedAgentSession = {
  nativeSessionId: string;
  startedAt: string | null;
  cwd: string | null;
  repo: { remote: string | null; branch: string | null; commit: string | null };
  title: string | null;
  messages: Gen2SessionImportMessage[];
};

export class SessionImportError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

// Card text the chat shows is a summary; the full output stays in the payload.
const MAX_ITEM_TEXT = 4_000;
const MAX_ITEMS_PER_MESSAGE = 300;
const NO_REPLY = "(The agent stopped before replying.)";

function clip(text: string) {
  return text.length > MAX_ITEM_TEXT
    ? `${text.slice(0, MAX_ITEM_TEXT)}\n…`
    : text;
}

function clipItem(item: Gen2TurnItem): Gen2TurnItem {
  if (item.kind === "command") return { ...item, output: clip(item.output) };
  if (item.kind === "reasoning" || item.kind === "message") {
    return { ...item, text: clip(item.text) };
  }
  return item;
}

export function toIsoOrNull(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizePath(path: string) {
  // Codex records command directories as `file:///C:/...` URIs.
  let local = path.replace(/^file:\/\/\/?(?=[A-Za-z]:)|^file:\/\//, "");
  try {
    if (local !== path) local = decodeURI(local);
  } catch {
    // Keep a malformed URI as written.
  }
  return local.replace(/\\/g, "/").replace(/\/$/, "");
}

/**
 * A path as the chat shows it: relative to the outermost session directory
 * containing it (the checkout, not a subdirectory a command ran in).
 */
export function sessionRelativePath(path: string, roots: string[]): string {
  const normalized = normalizePath(path);
  const lower = normalized.toLowerCase();
  const root = roots
    .map(normalizePath)
    .filter((entry) => entry && lower.startsWith(`${entry.toLowerCase()}/`))
    .sort((a, b) => a.length - b.length)[0];
  return root ? normalized.slice(root.length + 1) : normalized;
}

export class SessionTranscript {
  private readonly messages: Gen2SessionImportMessage[] = [];
  private pending = new Map<string, Gen2TurnItem>();
  private pendingAt: string | null = null;

  user(text: string, at: string | null) {
    this.flush();
    const body = text.trim();
    if (body)
      this.messages.push({ role: "user", body, items: null, createdAt: at });
  }

  /** Adds or replaces (by id) an activity card for the coming reply. */
  item(item: Gen2TurnItem, at: string | null) {
    this.pending.set(item.id, clipItem(item));
    this.pendingAt = at ?? this.pendingAt;
  }

  /** Updates a card added earlier, such as a tool call meeting its result. */
  update(id: string, change: (item: Gen2TurnItem) => Gen2TurnItem) {
    const existing = this.pending.get(id);
    if (existing) this.pending.set(id, clipItem(change(existing)));
  }

  reply(text: string, at: string | null) {
    const body = text.trim();
    if (!body) return;
    this.push(body, at);
  }

  finish(): Gen2SessionImportMessage[] {
    this.flush();
    return this.messages;
  }

  private flush() {
    if (!this.pending.size) return;
    const lastNote = [...this.pending.values()]
      .reverse()
      .find((item) => item.kind === "message" && item.text.trim());
    this.push(
      lastNote?.kind === "message" ? lastNote.text.trim() : NO_REPLY,
      this.pendingAt,
    );
  }

  private push(body: string, at: string | null) {
    const items = [...this.pending.values()].slice(-MAX_ITEMS_PER_MESSAGE);
    this.messages.push({
      role: "assistant",
      body,
      items: items.length ? items : null,
      createdAt: at ?? this.pendingAt,
    });
    this.pending = new Map();
    this.pendingAt = null;
  }
}
