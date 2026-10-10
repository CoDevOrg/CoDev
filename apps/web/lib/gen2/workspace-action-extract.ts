import {
  gen2WorkspaceActionSchema,
  type Gen2TurnItem,
  type Gen2TurnState,
  type Gen2WorkspaceAction,
} from "@codev/contracts";

/**
 * Turns an agent's ```codev-action <token> blocks into `workspaceAction`
 * items. Runs inside `reduceGen2Turn`, so the live view, the settled reply
 * the server saves and the history replay all see the same items and the
 * same stripped prose. Pure, total and idempotent: the browser re-reduces
 * the whole accumulated stream on every poll.
 *
 * Only a block whose opening line is exactly "```codev-action <token>" at
 * the start of a line, outside any other fence or blockquote, counts, so an
 * agent quoting a file or a web page inside a code block does not request
 * anything. Whether the token is the turn's nonce is checked by whoever acts
 * on the item, never here.
 */

const MAX_ACTIONS = 8;
const TOO_MANY = "Too many workspace actions in one turn.";
const ACTION_OPEN = /^```codev-action ([a-z0-9]{1,20})\s*$/;
// Cursor glues its stream segments, so prose can follow a closing fence.
const ACTION_CLOSE = /^```+(.*)$/;
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})\s*$/;
const QUOTE = /^ {0,3}> ?/;
const ACTION_TYPES = new Set<string>(
  gen2WorkspaceActionSchema.options.map((option) => option.shape.type.value),
);

type Fence = { marker: string; length: number; quoted: boolean };
type Block = { token: string; body: string };
type Scan = { prose: string; blocks: Block[]; changed: boolean };

function unquote(line: string) {
  let rest = line;
  let quoted = false;
  while (QUOTE.test(rest)) {
    rest = rest.replace(QUOTE, "");
    quoted = true;
  }
  return { rest, quoted };
}

function closes(line: string, fence: Fence) {
  const match = FENCE_CLOSE.exec(line);
  return (
    !!match && match[1]![0] === fence.marker && match[1]!.length >= fence.length
  );
}

/** The fence this line opens, if any (CommonMark: no backticks in a backtick info string). */
function opened(line: string): Fence | null {
  const { rest, quoted } = unquote(line);
  const match = FENCE_OPEN.exec(rest);
  if (!match) return null;
  const marker = match[1]![0]!;
  if (marker === "`" && match[2]!.includes("`")) return null;
  return { marker, length: match[1]!.length, quoted };
}

/** Whether `line` is still inside `fence`; a quoted fence ends with its quote. */
function insideFence(line: string, fence: Fence) {
  if (!fence.quoted) return !closes(line, fence);
  const { rest, quoted } = unquote(line);
  return quoted && !closes(rest, fence);
}

/**
 * Splits text into prose and complete action blocks. An unterminated block
 * at the end is still being streamed: it is dropped while the turn runs and
 * left as prose once the turn is over.
 */
export function scanGen2ActionBlocks(text: string, running: boolean): Scan {
  const prose: string[] = [];
  const blocks: Block[] = [];
  let fence: Fence | null = null;
  let action: { token: string; open: string; lines: string[] } | null = null;
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    if (action) {
      const close = ACTION_CLOSE.exec(line);
      if (!close) {
        action.lines.push(line);
        continue;
      }
      blocks.push({ token: action.token, body: action.lines.join("\n") });
      action = null;
      if (close[1]!.trim()) prose.push(close[1]!);
      continue;
    }
    if (fence) {
      const stillInside = insideFence(line, fence);
      const quoteEnded = fence.quoted && !unquote(line).quoted;
      if (stillInside || !quoteEnded) {
        if (!stillInside) fence = null;
        prose.push(line);
        continue;
      }
      fence = null;
    }
    const open = ACTION_OPEN.exec(line);
    if (open) {
      action = { token: open[1]!, open: line, lines: [] };
      continue;
    }
    fence = opened(line);
    prose.push(line);
  }
  if (action && !running) prose.push(action.open, ...action.lines);
  const changed = blocks.length > 0 || (action !== null && running);
  if (!changed) return { prose: text, blocks, changed };
  const joined = prose
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { prose: joined, blocks, changed };
}

function parseBlock(body: string): {
  action: Gen2WorkspaceAction | null;
  error: string | null;
} {
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    return { action: null, error: "Invalid JSON." };
  }
  const type =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as { type?: unknown }).type
      : undefined;
  if (typeof type !== "string" || !ACTION_TYPES.has(type)) {
    return { action: null, error: "Unknown action type." };
  }
  const parsed = gen2WorkspaceActionSchema.safeParse(value);
  if (parsed.success) return { action: parsed.data, error: null };
  const issue = parsed.error.issues[0];
  const path = issue?.path.join(".") ?? "";
  const message = issue?.message ?? "Invalid action.";
  return {
    action: null,
    error: (path ? `${path}: ${message}` : message).slice(0, 300),
  };
}

function actionItem(
  messageId: string,
  index: number,
  token: string | null,
  result: { action: Gen2WorkspaceAction | null; error: string | null },
): Gen2TurnItem {
  return {
    id: `${messageId.slice(0, 180)}:action:${index}`,
    kind: "workspaceAction",
    status: "completed",
    token,
    ...result,
  };
}

function code(text: string) {
  return text.includes("`") ? text : `\`${text}\``;
}

/** A plain sentence for a reply that held nothing but action blocks. */
function sentenceFor(action: Gen2WorkspaceAction) {
  switch (action.type) {
    case "open_file":
      return `Opened ${code(action.path)}.`;
    case "show_changes":
      return "Opened the changes.";
    case "open_review":
      return action.path
        ? `Opened the review of ${code(action.path)}.`
        : "Opened the review.";
    case "open_terminal":
      return "Opened the terminal.";
    case "open_preview":
      return `Opened the preview on port ${action.port}.`;
    case "rename_chat":
      return "Renamed this chat.";
    case "switch_worktree":
      return `Suggested switching to ${code(action.worktreeId)}.`;
    case "open_branch":
      return `Suggested opening ${code(action.branch)}.`;
    case "create_branch":
      return `Suggested creating the branch ${code(action.branch)}.`;
    case "open_share":
      return "Suggested opening Share.";
    case "invite_members":
      return `Suggested inviting ${action.people.length === 1 ? "1 person" : `${action.people.length} people`}.`;
    case "run_in_terminal":
      return "Suggested running a command in the terminal.";
    case "start_chat":
      return "Suggested starting a new chat.";
    case "open_settings":
      return "Suggested opening Settings.";
    case "update_goal":
      return "Marked the goal achieved.";
  }
}

function messageTexts(items: Gen2TurnItem[]) {
  return items.flatMap((item) => (item.kind === "message" ? [item.text] : []));
}

/** The reply with blocks removed, falling back to earlier prose or a sentence. */
function strippedReply(
  state: Gen2TurnState,
  items: Gen2TurnItem[],
  changed: boolean,
) {
  const running = state.status === "running";
  const original = messageTexts(state.items);
  const stripped = messageTexts(items).filter((text) => text.trim());
  // Cursor's reply is every segment glued together; rebuild it from the
  // stripped segments, since a block can start or end at a seam.
  const scan = scanGen2ActionBlocks(state.reply, running);
  let reply =
    changed && original.length > 0 && state.reply === original.join("")
      ? stripped.join("\n\n")
      : scan.prose;
  if (!reply.trim()) reply = stripped.at(-1)?.trim() ?? "";
  if (reply || running || (state.status === "failed" && state.error)) {
    return reply;
  }
  const actions = items.flatMap((item) =>
    item.kind === "workspaceAction" && item.action ? [item.action] : [],
  );
  return actions.map(sentenceFor).join(" ");
}

export function extractGen2WorkspaceActions(
  state: Gen2TurnState,
): Gen2TurnState {
  const running = state.status === "running";
  const existing = state.items.filter(
    (item) => item.kind === "workspaceAction",
  );
  let count = existing.length;
  let overflowed = existing.some(
    (item) => item.kind === "workspaceAction" && item.error === TOO_MANY,
  );
  let changed = false;
  const items: Gen2TurnItem[] = [];
  for (const item of state.items) {
    const scan =
      item.kind === "message" ? scanGen2ActionBlocks(item.text, running) : null;
    if (item.kind !== "message" || !scan?.changed) {
      items.push(item);
      continue;
    }
    changed = true;
    items.push({ ...item, text: scan.prose });
    scan.blocks.forEach((block, index) => {
      if (count < MAX_ACTIONS) {
        count += 1;
        items.push(
          actionItem(item.id, index, block.token, parseBlock(block.body)),
        );
      } else if (!overflowed) {
        overflowed = true;
        items.push(
          actionItem(item.id, index, block.token, {
            action: null,
            error: TOO_MANY,
          }),
        );
      }
    });
  }
  const reply = strippedReply(state, items, changed);
  if (!changed && reply === state.reply) return state;
  return { ...state, items, reply };
}
