"use client";

import {
  useLayoutEffect,
  useRef,
  type KeyboardEvent,
  type RefObject,
} from "react";
import type { Gen2AgentProviderName, Gen2ChatMessage } from "@codev/contracts";

import { parseWorkspaceCommand } from "./chat-workspace-commands";
import { useChatMentionItems } from "./use-chat-mention-items";
import { useChatSlashItems } from "./use-chat-slash-items";
import type { ComposerMentions } from "./use-composer-mentions";
import {
  useComposerTypeahead,
  type ComposerMenuAction,
  type ComposerMenuItem,
} from "./use-composer-typeahead";
import type { WorkspaceAgentContextValue } from "./workspace-controller";

export type ComposerMenuInput = {
  draft: ComposerMentions;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  enabled: boolean;
  agentContext: WorkspaceAgentContextValue | null;
  workspaceId: string;
  repositoryPrivate: boolean;
  chatId: string | null;
  messages: Gen2ChatMessage[];
  agent: Gen2AgentProviderName;
  connectedProviders: Gen2AgentProviderName[];
  canEdit: boolean;
  hasGoal: boolean;
  onOverride: (provider: Gen2AgentProviderName) => void;
  onSendText: (prompt: string) => void;
  onError: (message: string) => void;
  onOpenSettings?: (() => void) | undefined;
};

/** Runs a workspace action from the menu; false when it didn't happen. */
async function runWorkspaceAction(
  action: ComposerMenuAction,
  input: ComposerMenuInput,
) {
  const controller = input.agentContext?.controller;
  if (!controller) return false;
  try {
    if (action.type === "run") {
      const result = await controller.run(action.action);
      if (!result.ok) input.onError(result.message);
      return result.ok;
    }
    if (action.type !== "workspace") return false;
    if (action.command === "new") await controller.newChat();
    else if (action.command === "board") controller.setViewMode("board");
    else if (action.command === "import") controller.openImport();
    else controller.openSettings();
    return true;
  } catch {
    input.onError("That didn’t work. Try again.");
    return false;
  }
}

/** Does what a chosen entry (or a typed command) asks for; false if not. */
async function performComposerAction(
  action: ComposerMenuAction,
  input: ComposerMenuInput,
) {
  const controller = input.agentContext?.controller;
  if (action.type === "send") input.onSendText(action.prompt);
  else if (action.type === "override") input.onOverride(action.provider);
  else if (action.type === "notice") input.onError(action.message);
  else if (action.type === "connect") {
    if (controller) controller.openSettings();
    else input.onOpenSettings?.();
  } else return runWorkspaceAction(action, input);
  return action.type !== "notice";
}

/**
 * The composer's `/` and `@` menu: what it lists for the text at the caret,
 * what choosing an entry does, and the submit-time workspace commands.
 * Workspace commands run at once and never start a turn; a command that
 * fails comes back to the composer so it can be fixed.
 */
export function useComposerMenu(input: ComposerMenuInput) {
  const { draft } = input;
  const typeahead = useComposerTypeahead(draft.text, input.enabled);
  const { trigger } = typeahead;
  const slash = useChatSlashItems({ ...input, text: draft.text, trigger });
  const mentions = useChatMentionItems({ ...input, trigger });
  const items = trigger?.kind === "slash" ? slash.items : mentions;
  const pendingCaret = useRef<number | null>(null);

  useLayoutEffect(() => {
    const caret = pendingCaret.current;
    if (caret === null) return;
    pendingCaret.current = null;
    input.textareaRef.current?.setSelectionRange(caret, caret);
  });

  function placeCaret(caret: number) {
    pendingCaret.current = caret;
    typeahead.setCaret(caret);
  }

  /** Runs a whole-prompt command, putting the prompt back if it fails. */
  function runCommand(action: ComposerMenuAction) {
    const saved = { text: draft.text, mentions: draft.mentions };
    draft.clear();
    placeCaret(0);
    void performComposerAction(action, input).then((done) => {
      if (!done) draft.restore(saved);
    });
  }

  function select(item: ComposerMenuItem) {
    const { action } = item;
    if (!trigger || item.disabled) return;
    const before = draft.text.slice(0, trigger.start);
    const after = draft.text.slice(trigger.end);
    if (action.type === "retry") slash.retry();
    else if (action.type === "notice") input.onError(action.message);
    else if (action.type === "mention")
      placeCaret(
        draft.insertMention(action.mention, trigger.start, trigger.end),
      );
    else if (action.type === "insert") {
      const rest = after.startsWith(" ") ? after.slice(1) : after;
      draft.setText(before + action.text + rest);
      placeCaret(before.length + action.text.length);
    } else if (trigger.kind === "slash") runCommand(action);
    else {
      // An @ choice that acts (an agent switch) leaves the rest of the text.
      draft.setText(before + after);
      placeCaret(before.length);
      void performComposerAction(action, input);
    }
    input.textareaRef.current?.focus();
  }

  return {
    trigger,
    items,
    open: items.length > 0,
    activeIndex: Math.min(typeahead.activeIndex, Math.max(0, items.length - 1)),
    setActiveIndex: typeahead.setActiveIndex,
    setCaret: typeahead.setCaret,
    placeCaret,
    dismiss: typeahead.dismiss,
    select,
    handleKey: (event: KeyboardEvent<HTMLTextAreaElement>) =>
      typeahead.handleKey(event, items, select),
    /** Runs a typed workspace command instead of sending it; true if it did.
     *  A command that needs more (`/open` alone) stays to be fixed. */
    intercept(text: string) {
      const action = parseWorkspaceCommand(text, slash.context);
      if (!action) return false;
      if (action.type === "notice") input.onError(action.message);
      else runCommand(action);
      return true;
    },
  };
}

export type ComposerMenu = ReturnType<typeof useComposerMenu>;
