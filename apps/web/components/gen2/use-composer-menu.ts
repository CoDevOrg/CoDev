"use client";

import {
  useLayoutEffect,
  useRef,
  type KeyboardEvent,
  type RefObject,
} from "react";
import type { Gen2AgentProviderName, Gen2ChatMessage } from "@codev/contracts";

import { parseWorkspaceCommand } from "./chat-slash-commands";
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

/**
 * The composer's `/` and `@` menu: what it lists for the text at the caret,
 * what choosing an entry does, and the submit-time workspace commands.
 * Workspace commands run at once and never start a turn.
 */
export function useComposerMenu(input: ComposerMenuInput) {
  const { draft, agentContext } = input;
  const typeahead = useComposerTypeahead(draft.text, input.enabled);
  const { trigger } = typeahead;
  const slash = useChatSlashItems({ ...input, trigger });
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

  async function perform(action: ComposerMenuAction) {
    const controller = agentContext?.controller;
    if (action.type === "run") {
      const result = await controller?.run(action.action);
      if (result && !result.ok) input.onError(result.message);
    } else if (action.type === "workspace") {
      if (action.command === "new") await controller?.newChat();
      else if (action.command === "board") controller?.setViewMode("board");
      else if (action.command === "import") controller?.openImport();
      else controller?.openSettings();
    } else if (action.type === "send") input.onSendText(action.prompt);
    else if (action.type === "override") input.onOverride(action.provider);
    else if (action.type === "connect")
      (controller?.openSettings ?? input.onOpenSettings)?.();
    else if (action.type === "notice") input.onError(action.message);
  }

  function select(item: ComposerMenuItem) {
    if (!trigger) return;
    const { action } = item;
    const before = draft.text.slice(0, trigger.start);
    const after = draft.text.slice(trigger.end);
    if (action.type === "mention") {
      placeCaret(
        draft.insertMention(action.mention, trigger.start, trigger.end),
      );
    } else if (action.type === "insert") {
      const rest = after.startsWith(" ") ? after.slice(1) : after;
      draft.setText(before + action.text + rest);
      placeCaret(before.length + action.text.length);
    } else {
      // A slash command is the whole prompt; an @ choice leaves the rest.
      draft.setText(trigger.kind === "slash" ? "" : before + after);
      placeCaret(trigger.kind === "slash" ? 0 : before.length);
      void perform(action);
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
    /** Runs a typed workspace command instead of sending it; true if it did. */
    intercept(text: string) {
      const action = parseWorkspaceCommand(text, slash.context);
      if (!action) return false;
      // Keep a command that needs more (`/open` alone) so it can be fixed.
      if (action.type !== "notice") {
        draft.setText("");
        placeCaret(0);
      }
      void perform(action);
      return true;
    },
  };
}

export type ComposerMenu = ReturnType<typeof useComposerMenu>;
