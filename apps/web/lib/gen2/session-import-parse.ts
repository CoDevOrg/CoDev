import type {
  Gen2SessionImportMessage,
  Gen2SessionImportProvider,
} from "@codev/contracts";

import { gen2ChatTitleFromPrompt } from "./chats-format";
import { parseClaudeSession } from "./session-import-claude";
import { parseCodexSession } from "./session-import-codex";
import { redactSessionJsonl } from "./session-import-redact";
import {
  SessionImportError,
  type ParsedAgentSession,
} from "./session-import-transcript";

export const SESSION_IMPORT_MAX_BYTES = 64 * 1024 * 1024;
const MAX_MESSAGES = 10_000;
const MAX_EDITED_FILES = 200;
const SAMPLE_EACH_END = 3;

const PARSERS: Record<
  Gen2SessionImportProvider,
  (records: unknown[]) => ParsedAgentSession
> = {
  codex: parseCodexSession,
  claude: parseClaudeSession,
};

function decode(bytes: Uint8Array) {
  if (!bytes.byteLength) {
    throw new SessionImportError("Choose a session file that isn't empty.");
  }
  if (bytes.byteLength > SESSION_IMPORT_MAX_BYTES) {
    throw new SessionImportError("Session files can be up to 64 MB.", 413);
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new SessionImportError("The session file must be UTF-8 text.");
  }
}

function parseLines(text: string): unknown[] {
  return text.split("\n").flatMap((line) => {
    if (!line.trim()) return [];
    try {
      return [JSON.parse(line) as unknown];
    } catch {
      // A session still being written ends in a partial line.
      return [];
    }
  });
}

function editedFiles(messages: Gen2SessionImportMessage[]) {
  const paths = messages.flatMap((message) =>
    (message.items ?? []).flatMap((item) =>
      item.kind === "fileChange" ? item.changes.map((c) => c.path) : [],
    ),
  );
  return [...new Set(paths)].slice(0, MAX_EDITED_FILES);
}

/**
 * Redacts, then parses, an uploaded session. Only the redacted text is
 * returned: it is what gets stored, shown, and later resumed.
 */
export function readSessionImport(
  provider: Gen2SessionImportProvider,
  bytes: Uint8Array,
) {
  const { text, redactions } = redactSessionJsonl(decode(bytes));
  const session = PARSERS[provider](parseLines(text));
  if (!session.messages.length) {
    throw new SessionImportError("This session has no messages to import yet.");
  }
  if (session.messages.length > MAX_MESSAGES) {
    throw new SessionImportError(
      "This session is too long to import (over 10,000 messages).",
      413,
    );
  }
  const firstPrompt = session.messages.find((m) => m.role === "user")?.body;
  const title = (
    session.title ?? gen2ChatTitleFromPrompt(firstPrompt ?? "")
  ).slice(0, 80);
  const { messages } = session;
  const sample =
    messages.length > SAMPLE_EACH_END * 2
      ? [
          ...messages.slice(0, SAMPLE_EACH_END),
          ...messages.slice(-SAMPLE_EACH_END),
        ]
      : messages;
  return {
    text,
    session,
    preview: {
      provider,
      title,
      startedAt: session.startedAt,
      messageCount: messages.length,
      itemCount: messages.reduce((n, m) => n + (m.items?.length ?? 0), 0),
      repo: session.repo,
      editedFiles: editedFiles(messages),
      redactions,
      sample,
    },
  };
}
