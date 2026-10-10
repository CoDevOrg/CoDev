"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import type { Gen2AgentProviderName, Gen2ChatMessage } from "@codev/contracts";

import { recallableChatText } from "./chat-recall";
import { useChatAttachments } from "./use-chat-attachments";
import type { ChatDraft } from "./use-chat-send";
import type { ChatTurnOutcome } from "./use-chat-turn";
import { useComposerMentions } from "./use-composer-mentions";
import type { WorkspaceAgentContextValue } from "./workspace-controller";

/**
 * The message being written: text and mentions, attachments, a one-message
 * agent switch, and one follow-up queued while a turn runs. A draft that
 * fails to start comes back unless the member has typed a new one.
 */
export function useChatDraft({
  send,
  busy,
  modelReady,
  switchingChat,
  agentContext,
  textareaRef,
  setError,
}: {
  send: (draft: ChatDraft) => Promise<boolean>;
  busy: boolean;
  modelReady: (override: Gen2AgentProviderName | null) => boolean;
  switchingChat: boolean;
  agentContext: WorkspaceAgentContextValue | null;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  setError: (message: string) => void;
}) {
  const text = useComposerMentions();
  const files = useChatAttachments(setError);
  const [override, setOverride] = useState<Gen2AgentProviderName | null>(null);
  const [queued, setQueued] = useState<{
    draft: ChatDraft;
    ready: boolean;
  } | null>(null);

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

  // Prefill from a start_chat handoff once the chat it opened has loaded.
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

  function restore(saved: ChatDraft) {
    text.replace((current) =>
      current.text ? current : { text: saved.text, mentions: saved.mentions },
    );
    files.setAttachments((current) =>
      current.length ? current : saved.attachments,
    );
    setOverride((current) => current ?? saved.override);
  }

  async function sendDraft(saved: ChatDraft) {
    if (!(await send(saved))) restore(saved);
  }

  /** Sends the draft, or queues it as the one follow-up while busy. */
  function submit() {
    const saved: ChatDraft = {
      text: text.text,
      mentions: text.mentions,
      attachments: files.attachments,
      override,
    };
    if (!saved.text.trim() && saved.attachments.length === 0) return;
    if (busy ? queued !== null : !modelReady(override)) return;
    text.replace({ text: "", mentions: [] });
    files.setAttachments([]);
    setOverride(null);
    if (busy) setQueued({ draft: saved, ready: false });
    else void sendDraft(saved);
  }

  /** Puts text in the composer (a card, a recall) with the caret at the end. */
  function fill(value: string) {
    text.fill(value);
    window.setTimeout(() => {
      const element = textareaRef.current;
      element?.focus();
      element?.setSelectionRange(element.value.length, element.value.length);
    }, 0);
  }

  return {
    text,
    files,
    override,
    setOverride,
    queued: queued !== null,
    cancelQueued() {
      if (queued) restore(queued.draft);
      setQueued(null);
    },
    submit,
    fill,
    recall(messages: Gen2ChatMessage[]) {
      const last = messages.findLast((message) => message.role === "user");
      if (last) fill(recallableChatText(last.body));
      return Boolean(last);
    },
    /** A queued follow-up goes after a clean finish; otherwise it returns. */
    onSettled(outcome: ChatTurnOutcome) {
      if (!queued) return;
      if (outcome.status === "completed") setQueued({ ...queued, ready: true });
      else {
        setQueued(null);
        restore(queued.draft);
      }
    },
  };
}

export type ChatDraftState = ReturnType<typeof useChatDraft>;
