"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import type { Gen2AgentProviderName, Gen2ChatMessage } from "@codev/contracts";

import { MAX_GEN2_CHAT_ATTACHMENTS } from "@/lib/gen2/chat-attachments";
import { recallableChatText } from "./chat-recall";
import { useChatAttachments } from "./use-chat-attachments";
import type { ChatDraft } from "./use-chat-send";
import type { ChatTurnOutcome } from "./use-chat-turn";
import {
  useComposerMentions,
  type ComposerMentions,
} from "./use-composer-mentions";
import type { WorkspaceAgentContextValue } from "./workspace-controller";

type DraftInput = {
  send: (draft: ChatDraft) => Promise<boolean>;
  /** A turn is starting, waking the machine, or running. */
  busy: boolean;
  /** A turn is running; only then can one follow-up queue behind it. */
  running: boolean;
  modelReady: (override: Gen2AgentProviderName | null) => boolean;
  chatId: string | null;
  switchingChat: boolean;
  agentContext: WorkspaceAgentContextValue | null;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  setError: (message: string) => void;
};

/** Prefills from a start_chat handoff once the chat it opened has loaded. */
function useDraftHandoff(
  { agentContext, switchingChat, textareaRef }: DraftInput,
  text: ComposerMentions,
) {
  const request = agentContext?.draftRequest ?? null;
  const [applied, setApplied] = useState<string | null>(null);
  if (request && request.id !== applied && !switchingChat) {
    setApplied(request.id);
    text.fill(request.text);
  }
  const consumeRef = useRef(agentContext?.consumeDraftRequest);
  useEffect(() => {
    consumeRef.current = agentContext?.consumeDraftRequest;
  });
  useEffect(() => {
    if (!applied) return;
    consumeRef.current?.(applied);
    textareaRef.current?.focus();
  }, [applied, textareaRef]);
}

/** The draft's text, files and agent switch, and putting a saved one back. */
function useDraftParts(setError: (message: string) => void) {
  const text = useComposerMentions();
  const files = useChatAttachments(setError);
  const [override, setOverride] = useState<Gen2AgentProviderName | null>(null);
  return {
    text,
    files,
    override,
    setOverride,
    /** The draft as written, leaving the composer empty. */
    take(): ChatDraft {
      const draft: ChatDraft = {
        text: text.text,
        mentions: text.mentions,
        attachments: files.attachments,
        override,
      };
      text.clear();
      files.setAttachments([]);
      setOverride(null);
      return draft;
    },
    /** Puts a draft back; anything typed since stays, below it. */
    restore(saved: ChatDraft) {
      text.restore(saved);
      files.setAttachments((current) =>
        [...saved.attachments, ...current].slice(0, MAX_GEN2_CHAT_ATTACHMENTS),
      );
      setOverride((current) => current ?? saved.override);
    },
  };
}

/**
 * The message being written: text and mentions, attachments, a one-message
 * agent switch, and one follow-up queued while a turn runs. A draft that
 * fails to start comes back, above anything typed since.
 */
export function useChatDraft(input: DraftInput) {
  const { send, busy, running, chatId } = input;
  const parts = useDraftParts(input.setError);
  const { text, files, override } = parts;
  const [queued, setQueued] = useState<{
    draft: ChatDraft;
    ready: boolean;
  } | null>(null);
  useDraftHandoff(input, text);

  // Send the queued follow-up once the turn before it has settled.
  const flush = queued?.ready && !busy ? queued.draft : null;
  useEffect(() => {
    if (!flush) return;
    const timer = window.setTimeout(() => {
      setQueued(null);
      void sendDraft(flush);
    }, 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flush]);

  async function sendDraft(saved: ChatDraft) {
    if (!(await send(saved))) parts.restore(saved);
  }

  /** Sends the draft, or queues it as the one follow-up while a turn runs.
   *  While a turn is still starting, Enter waits and the text stays. */
  function submit() {
    if (!text.text.trim() && files.attachments.length === 0) return;
    if (running ? queued !== null : busy || !input.modelReady(override)) return;
    const saved = parts.take();
    if (running) setQueued({ draft: saved, ready: false });
    else void sendDraft(saved);
  }

  /** Puts text in the composer (a card, a recall) with the caret at the end. */
  function fill(value: string) {
    text.fill(value);
    window.setTimeout(() => {
      const element = input.textareaRef.current;
      element?.focus();
      element?.setSelectionRange(element.value.length, element.value.length);
    }, 0);
  }

  return {
    text,
    files,
    override,
    setOverride: parts.setOverride,
    queued: queued !== null,
    cancelQueued() {
      if (queued) parts.restore(queued.draft);
      setQueued(null);
    },
    submit,
    fill,
    recall(messages: Gen2ChatMessage[]) {
      const last = messages.findLast((message) => message.role === "user");
      if (last) fill(recallableChatText(last.body));
      return Boolean(last);
    },
    /** A queued follow-up goes after a clean finish in the same chat;
     *  otherwise it comes back to the composer. */
    onSettled(outcome: ChatTurnOutcome) {
      if (!queued) return;
      if (outcome.status === "completed" && outcome.chatId === chatId)
        return setQueued({ ...queued, ready: true });
      setQueued(null);
      parts.restore(queued.draft);
    },
  };
}

export type ChatDraftState = ReturnType<typeof useChatDraft>;
