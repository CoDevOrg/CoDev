import { describe, expect, it } from "vitest";

import {
  applyCommandHistory,
  createCommandHistory,
} from "./terminal-command-history";

describe("terminal command history", () => {
  it("recalls the previous command and returns to the draft", () => {
    let history = createCommandHistory();
    history = applyCommandHistory(history, "ls").history;
    history = applyCommandHistory(history, "\r").history;
    history = applyCommandHistory(history, "git status").history;
    history = applyCommandHistory(history, "\r").history;
    history = applyCommandHistory(history, "pw").history;

    const up = applyCommandHistory(history, "\u001b[A");
    expect(up.send).toBe("\u0015git status");
    const older = applyCommandHistory(up.history, "\u001b[A");
    expect(older.send).toBe("\u0015ls");
    const down = applyCommandHistory(older.history, "\u001b[B");
    expect(down.send).toBe("\u0015git status");
    const draft = applyCommandHistory(down.history, "\u001b[B");
    expect(draft.send).toBe("\u0015pw");
    expect(draft.history.line).toBe("pw");
  });

  it("does nothing when there is no earlier command", () => {
    const history = createCommandHistory();
    expect(applyCommandHistory(history, "\u001b[A").send).toBe("");
    expect(applyCommandHistory(history, "\u001b[B").send).toBe("");
  });
});
