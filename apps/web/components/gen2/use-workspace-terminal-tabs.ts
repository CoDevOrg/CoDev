"use client";

import { useCallback, useRef, useState } from "react";

import type { TerminalQueuedInput } from "./use-workspace-terminal-io";

export type WorkspaceTerminalTab = {
  id: string;
  worktreeId: string;
  label: string;
  /** The command and Enter, typed once into the tab's new session. */
  input: TerminalQueuedInput;
};

export const MAIN_TERMINAL_TAB = "shell";

const LABEL_CHARS = 24;

function labelFor(command: string) {
  return command.length > LABEL_CHARS
    ? `${command.slice(0, LABEL_CHARS - 1).trimEnd()}…`
    : command;
}

/**
 * Terminal tabs beside the worktree's own shell. Each runs one command the
 * member accepted in a session of its own; closing the tab ends that
 * session. A tab belongs to a worktree and only shows while it is selected.
 */
export function useWorkspaceTerminalTabs(worktreeId: string) {
  const [tabs, setTabs] = useState<WorkspaceTerminalTab[]>([]);
  const [selected, setSelected] = useState(MAIN_TERMINAL_TAB);
  const nextId = useRef(0);

  const open = useCallback((target: string, command: string) => {
    nextId.current += 1;
    const id = `run-${nextId.current}`;
    const tab = {
      id,
      worktreeId: target,
      label: labelFor(command),
      input: { id, text: `${command}\r` },
    };
    setTabs((current) => [...current, tab]);
    setSelected(tab.id);
  }, []);

  const close = useCallback((id: string) => {
    setTabs((current) => current.filter((tab) => tab.id !== id));
    setSelected((current) => (current === id ? MAIN_TERMINAL_TAB : current));
  }, []);

  const visible = tabs.filter((tab) => tab.worktreeId === worktreeId);
  const activeId = visible.some((tab) => tab.id === selected)
    ? selected
    : MAIN_TERMINAL_TAB;
  return { tabs, visible, activeId, select: setSelected, open, close };
}
