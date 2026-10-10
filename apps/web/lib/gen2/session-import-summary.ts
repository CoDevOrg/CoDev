import type { Gen2SessionImportProvider } from "@codev/contracts";

import { gen2ChatTitleFromPrompt } from "./chats-format";
import { parseClaudeSession } from "./session-import-claude";
import { parseCodexSession } from "./session-import-codex";

/**
 * A one-line description of a local session for the session browser, read
 * from the start of the file (and, for Claude's rename, its end) without
 * loading a rollout that can run to tens of megabytes. Sub-agent sessions
 * and files that are not sessions summarize to null, so the browser hides
 * exactly what an upload would reject.
 */

export type LocalSessionSummary = {
  title: string;
  startedAt: string | null;
  branch: string | null;
};

function toRecords(text: string): unknown[] {
  return text.split("\n").flatMap((line) => {
    try {
      return line.trim() ? [JSON.parse(line) as unknown] : [];
    } catch {
      // The head and tail slices cut lines in half.
      return [];
    }
  });
}

/** Claude records a `/rename` as a `custom-title` line, usually near the end. */
function claudeCustomTitle(tail: string) {
  const titles = toRecords(tail).flatMap((record) => {
    const entry = (record ?? {}) as { type?: unknown; customTitle?: unknown };
    return entry.type === "custom-title" &&
      typeof entry.customTitle === "string"
      ? [entry.customTitle]
      : [];
  });
  return titles.at(-1) ?? null;
}

export function summarizeLocalSession(
  provider: Gen2SessionImportProvider,
  head: string,
  tail = "",
): LocalSessionSummary | null {
  try {
    const records = toRecords(head);
    const session =
      provider === "codex"
        ? parseCodexSession(records)
        : parseClaudeSession(records);
    const prompt = session.messages.find((m) => m.role === "user")?.body;
    // A long preamble can push the first prompt past the head slice.
    const title =
      (provider === "claude" ? claudeCustomTitle(tail) : null) ??
      session.title ??
      (prompt ? gen2ChatTitleFromPrompt(prompt) : "Untitled session");
    return {
      title,
      startedAt: session.startedAt,
      branch: session.repo.branch,
    };
  } catch {
    return null;
  }
}
