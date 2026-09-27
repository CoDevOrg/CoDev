/**
 * Best-effort extraction of the assistant text a room reply has produced *so
 * far*, from the raw CLI output buffered mid-turn.
 *
 * This is deliberately tolerant and deliberately non-authoritative. The final
 * reply is still parsed by `parseClaudeResult` / `codexFinalMessage` from the
 * complete output, so if an event shape here goes unrecognized the only
 * consequence is that the room sees no live text until the turn finishes — the
 * saved reply is unaffected. Never make the committed reply depend on this.
 *
 * Both CLIs emit line-delimited JSON through a PTY, so lines can carry CR and
 * surrounding diagnostics; the trailing line is usually incomplete while a turn
 * is still running and must be ignored.
 */

/**
 * The poll transport delivers base64 chunks that `atob` turns into one code
 * unit per byte. Recover the bytes and read them as UTF-8; a multibyte sequence
 * cut off at the buffer's end becomes a replacement character, which is
 * harmless because the trailing incomplete line is dropped anyway.
 */
export function decodeReplyBytes(binary: string): string {
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++)
    bytes[index] = binary.charCodeAt(index);
  return new TextDecoder().decode(bytes);
}

/** Complete JSON objects only: drop a trailing partial line, tolerate PTY noise. */
function completeJsonLines(output: string): unknown[] {
  const lines = output.split(/\r?\n/);
  // Anything after the last newline is still being written.
  lines.pop();
  const events: unknown[] = [];
  for (const line of lines) {
    const start = line.indexOf("{");
    const end = line.lastIndexOf("}");
    if (start < 0 || end < start) continue;
    try {
      events.push(JSON.parse(line.slice(start, end + 1)));
    } catch {
      // A diagnostic or a line split mid-object; the next poll will resend it.
    }
  }
  return events;
}

function textBlocks(content: unknown): string {
  if (!Array.isArray(content)) return "";
  let text = "";
  for (const block of content) {
    if (
      block &&
      typeof block === "object" &&
      (block as { type?: unknown }).type === "text" &&
      typeof (block as { text?: unknown }).text === "string"
    )
      text += (block as { text: string }).text;
  }
  return text;
}

/**
 * Claude `--output-format stream-json --include-partial-messages`.
 *
 * Two shapes carry assistant text, and which of them appears depends on the
 * CLI version, so both are handled: `assistant` events carry a *complete*
 * message (a snapshot, so it replaces what deltas built up), and
 * `stream_event` wraps the provider's own streaming events, whose
 * `content_block_delta` entries append one fragment at a time.
 */
export function extractPartialClaudeText(output: string): string {
  let settled = "";
  let streaming = "";
  for (const event of completeJsonLines(output)) {
    if (!event || typeof event !== "object") continue;
    const type = (event as { type?: unknown }).type;

    if (type === "result") {
      const result = (event as { result?: unknown }).result;
      // The authoritative final text; anything buffered before it is stale.
      if (typeof result === "string") return result.trim();
      continue;
    }

    if (type === "assistant") {
      const message = (event as { message?: unknown }).message;
      // Synthetic API-error messages are surfaced as assistant text by the CLI
      // but are not part of the reply.
      if ((event as { is_api_error_message?: unknown }).is_api_error_message)
        continue;
      if (message && typeof message === "object") {
        settled += textBlocks((message as { content?: unknown }).content);
        streaming = "";
      }
      continue;
    }

    if (type === "stream_event") {
      const inner = (event as { event?: unknown }).event;
      if (!inner || typeof inner !== "object") continue;
      const innerType = (inner as { type?: unknown }).type;
      if (innerType === "content_block_delta") {
        const delta = (inner as { delta?: unknown }).delta;
        if (
          delta &&
          typeof delta === "object" &&
          typeof (delta as { text?: unknown }).text === "string"
        )
          streaming += (delta as { text: string }).text;
      }
    }
  }
  return (settled + streaming).trim();
}

/**
 * Codex `exec --json`. `item.completed` is the finished message that
 * `codexFinalMessage` already reads; `item.updated` carries the same item's
 * text as it grows, so the latest of either wins.
 */
export function extractPartialCodexText(output: string): string {
  let latest = "";
  for (const event of completeJsonLines(output)) {
    if (!event || typeof event !== "object") continue;
    const type = (event as { type?: unknown }).type;
    if (type !== "item.updated" && type !== "item.completed") continue;
    const item = (event as { item?: unknown }).item;
    if (!item || typeof item !== "object") continue;
    if ((item as { type?: unknown }).type !== "agent_message") continue;
    const text = (item as { text?: unknown }).text;
    if (typeof text === "string") latest = text;
  }
  return latest.trim();
}

export function extractPartialReplyText(
  output: string,
  provider: "claude" | "codex",
): string {
  return provider === "claude"
    ? extractPartialClaudeText(output)
    : extractPartialCodexText(output);
}

/**
 * How much new text has to accumulate before the room is told about it. Each
 * publish is a durable workflow step plus a Redis write, and a poll can return
 * as fast as the CLI writes, so this trades a little smoothness for a bounded
 * number of steps per turn.
 */
export const PARTIAL_PUBLISH_MIN_GROWTH = 120;
