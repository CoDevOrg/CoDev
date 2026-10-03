export type CommandHistory = {
  commands: string[];
  /** `commands.length` means the line being typed, not a recalled command. */
  cursor: number;
  draft: string;
  line: string;
};

export function createCommandHistory(): CommandHistory {
  return { commands: [], cursor: 0, draft: "", line: "" };
}

export type HistoryEffect = {
  history: CommandHistory;
  /** Bytes that replace the key. Empty when the key should pass through. */
  send: string | null;
};

const UP = "\u001b[A";
const DOWN = "\u001b[B";

/**
 * Up and down walk commands submitted in this shell. The guest's `/bin/sh`
 * does not, so the recalled line is written over the current one with the
 * terminal's kill-line character.
 */
export function applyCommandHistory(
  history: CommandHistory,
  data: string,
): HistoryEffect {
  if (data === UP) return recall(history, -1);
  if (data === DOWN) return recall(history, 1);
  return { history: noteInput(history, data), send: null };
}

function recall(history: CommandHistory, direction: -1 | 1): HistoryEffect {
  const { commands } = history;
  if (commands.length === 0) return { history, send: "" };
  const atDraft = history.cursor === commands.length;
  if (direction === -1 && history.cursor === 0) return { history, send: "" };
  if (direction === 1 && atDraft) return { history, send: "" };
  const cursor = history.cursor + direction;
  const line =
    cursor === commands.length ? history.draft : (commands[cursor] ?? "");
  return {
    history: {
      ...history,
      cursor,
      draft: atDraft ? history.line : history.draft,
      line,
    },
    send: `\u0015${line}`,
  };
}

function noteInput(history: CommandHistory, data: string): CommandHistory {
  let line = history.line;
  let commands = history.commands;
  let cursor = history.cursor;
  let draft = history.draft;
  for (const character of data) {
    if (character === "\r" || character === "\n") {
      const submitted = line.trim();
      if (submitted) commands = [...commands, line];
      line = "";
      draft = "";
      cursor = commands.length;
      continue;
    }
    if (character === "\u007f" || character === "\b") {
      line = line.slice(0, -1);
      cursor = commands.length;
      continue;
    }
    if (character === "\u0015" || character === "\u0003") {
      line = "";
      cursor = commands.length;
      continue;
    }
    if (character < " ") continue;
    line += character;
    cursor = commands.length;
  }
  return { commands, cursor, draft, line };
}
