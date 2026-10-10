"use client";

import { useState, type KeyboardEvent } from "react";
import type {
  Gen2AgentProviderName,
  Gen2WorkspaceAction,
} from "@codev/contracts";

import type { ComposerMention } from "./use-composer-mentions";

/** The `/command` or `@query` being typed at the caret. */
export type ComposerTrigger = {
  kind: "slash" | "mention";
  start: number;
  end: number;
  query: string;
  /** A workspace command whose argument is being typed (`/branch feat`). */
  command: string | null;
};

export type ComposerMenuAction =
  | { type: "insert"; text: string }
  | { type: "mention"; mention: ComposerMention }
  | { type: "run"; action: Gen2WorkspaceAction }
  | { type: "workspace"; command: "new" | "board" | "settings" | "import" }
  | { type: "send"; prompt: string }
  | { type: "override"; provider: Gen2AgentProviderName }
  | { type: "connect"; provider: Gen2AgentProviderName }
  | { type: "notice"; message: string };

export type ComposerMenuIcon =
  | "plan"
  | "ask"
  | "goal"
  | "review"
  | "init"
  | "file"
  | "dir"
  | "chat"
  | "agent"
  | "selection"
  | "terminal"
  | "changes"
  | "branch"
  | "create"
  | "share"
  | "new"
  | "rename"
  | "board"
  | "settings"
  | "import"
  | "preview"
  | "provider";

export type ComposerMenuItem = {
  id: string;
  group: string;
  label: string;
  detail?: string | undefined;
  icon: ComposerMenuIcon;
  provider?: Gen2AgentProviderName | null | undefined;
  action: ComposerMenuAction;
};

const SLASH_NAME = /^\/([a-z]*)$/i;
const SLASH_ARGUMENT = /^\/(open|branch|rename|share|preview) (.*)$/i;
const MENTION = /(?:^|\s)@([^\s@]*)$/;

function findTrigger(text: string, caret: number): ComposerTrigger | null {
  const before = text.slice(0, caret);
  const name = SLASH_NAME.exec(before);
  if (name)
    return {
      kind: "slash",
      start: 0,
      end: caret,
      query: name[1]!,
      command: null,
    };
  const argument = SLASH_ARGUMENT.exec(before);
  if (argument)
    return {
      kind: "slash",
      start: 0,
      end: caret,
      query: argument[2]!,
      command: argument[1]!.toLowerCase(),
    };
  const mention = MENTION.exec(before);
  if (!mention) return null;
  const query = mention[1]!;
  return {
    kind: "mention",
    start: caret - query.length - 1,
    end: caret,
    query,
    command: null,
  };
}

/**
 * Finds the trigger at the caret and owns the menu's keyboard: Up/Down move,
 * Enter or Tab choose, Escape dismisses until a new trigger starts. Keys
 * typed during IME composition are never taken.
 */
export function useComposerTypeahead(text: string, enabled: boolean) {
  const [caret, setCaret] = useState(0);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [active, setActive] = useState({ key: "", index: 0 });
  const found = enabled
    ? findTrigger(text, Math.min(caret, text.length))
    : null;
  const anchor = found
    ? `${found.kind}:${found.start}:${found.command ?? ""}`
    : null;
  if (dismissed && dismissed !== anchor) setDismissed(null);
  const trigger = found && anchor !== dismissed ? found : null;
  const key = trigger ? `${anchor}:${trigger.query}` : "";
  const index = active.key === key ? active.index : 0;

  /** Handles a menu key; true when the event was the menu's. */
  function handleKey(
    event: KeyboardEvent<HTMLTextAreaElement>,
    items: ComposerMenuItem[],
    select: (item: ComposerMenuItem) => void,
  ) {
    if (!trigger || items.length === 0 || event.nativeEvent.isComposing)
      return false;
    const count = items.length;
    const chosen = items[Math.min(index, count - 1)]!;
    const keys: Record<string, () => void> = {
      ArrowDown: () => setActive({ key, index: (index + 1) % count }),
      ArrowUp: () => setActive({ key, index: (index - 1 + count) % count }),
      Enter: () => select(chosen),
      Tab: () => select(chosen),
      Escape: () => setDismissed(anchor),
    };
    const handler = keys[event.key];
    if (!handler || (event.key === "Enter" && event.shiftKey)) return false;
    event.preventDefault();
    handler();
    return true;
  }

  return {
    trigger,
    activeIndex: index,
    setActiveIndex: (next: number) => setActive({ key, index: next }),
    /** Records the caret after input, selection or a programmatic insert. */
    setCaret,
    dismiss: () => setDismissed(anchor),
    handleKey,
  };
}
