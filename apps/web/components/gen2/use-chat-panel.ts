"use client";

import { useMemo, useRef, useState } from "react";
import type { Gen2PossibleDuplicateTask } from "@codev/contracts";

import { canRunGen2Agent } from "@/lib/gen2/agent-policy";
import { deriveGen2ChatGoal } from "@/lib/gen2/chat-goal";
import { useChatDraft } from "./use-chat-draft";
import { useChatSession, type ChatSessionInput } from "./use-chat-session";
import type { ChatTurnOutcome } from "./use-chat-turn";
import {
  GOAL_CONTINUE_PROMPT,
  useGoalContinuation,
} from "./use-goal-continuation";
import { useWorkspaceActionDispatch } from "./use-workspace-action-dispatch";
import { useObservedTurns } from "./use-observed-turns";
import { useTurnDriveElection } from "./use-turn-drive-election";
import { useWorkspaceAgent } from "./workspace-controller";

export type ChatPanelInput = Omit<
  ChatSessionInput,
  | "agentContext"
  | "transcriptRef"
  | "setError"
  | "setPossibleDuplicate"
  | "onSettled"
>;

/** The panel's notices and the elements its hooks reach for. */
function usePanelBasics() {
  const [error, setError] = useState("");
  const [possibleDuplicate, setPossibleDuplicate] =
    useState<Gen2PossibleDuplicateTask | null>(null);
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  return {
    error,
    setError,
    possibleDuplicate,
    setPossibleDuplicate,
    transcriptRef,
    textareaRef,
  };
}

/**
 * The chat panel's state, wired together: the session (agent, thread, live
 * turn), the draft, the goal and Keep going, and the dispatcher for the
 * live turn's workspace actions.
 */
export function useChatPanel(props: ChatPanelInput) {
  const { workspace } = props;
  const agentContext = useWorkspaceAgent();
  const canEdit =
    workspace.role !== "viewer" && (agentContext?.canEdit ?? true);
  // The shell reports its workspace "ready" exactly while it is connected.
  const connected = canRunGen2Agent(workspace.status);
  const basics = usePanelBasics();
  const { setError, textareaRef } = basics;
  const { transcriptRef, setPossibleDuplicate } = basics;
  const session = useChatSession({
    ...props,
    agentContext,
    transcriptRef,
    setError,
    setPossibleDuplicate,
    onSettled,
  });
  const { thread, turn, busy } = session;
  const { chatId } = thread;
  const messages = thread.thread.messages;
  const goal = useMemo(() => deriveGen2ChatGoal(messages), [messages]);
  const draft = useChatDraft({
    send: session.sender.send,
    busy,
    running: turn.running,
    modelReady: (choice) => Boolean(session.modelFor(choice)),
    chatId,
    switchingChat: thread.switchingChat,
    agentContext,
    textareaRef,
    setError,
  });
  const continuation = useGoalContinuation({
    goal,
    chatId,
    connected,
    // Keep going never wakes a stopped machine; it ends instead.
    onContinue: () =>
      connected ? sendText(GOAL_CONTINUE_PROMPT) : continuation.stop(),
  });
  // Only the chat whose turn this tab drives shows that turn and acts on it.
  const ownsTurn = turn.liveChatId !== null && turn.liveChatId === chatId;
  const live = ownsTurn ? turn.live : null;
  const dispatch = useWorkspaceActionDispatch({
    workspaceId: workspace.id,
    chatId,
    live,
  });
  // Other members' turns: shown read-only, and kept moving if their tab left.
  const observedTurns = useObservedTurns(turn.live?.sessionId ?? null);
  useTurnDriveElection({
    workspaceId: workspace.id,
    canEdit,
    turns: observedTurns,
  });
  const observedTurn = chatId ? (observedTurns.get(chatId) ?? null) : null;

  function onSettled(outcome: ChatTurnOutcome) {
    // A queued follow-up goes first; Keep going waits for the next settle.
    if (!draft.queued) continuation.onSettled(outcome);
    draft.onSettled(outcome);
  }

  /** Sends a fixed prompt: Continue, a next step, a goal control. */
  function sendText(prompt: string) {
    const text = { text: prompt, mentions: [], attachments: [] };
    void session.sender.send({ ...text, override: null });
  }

  const empty = messages.length === 0 && !busy && !thread.switchingChat;
  const state = { workspace, agentContext, canEdit, connected, empty };
  return {
    ...session,
    ...basics,
    ...state,
    messages,
    goal,
    draft,
    continuation,
    dispatch,
    ownsTurn,
    observedTurn,
    sendText,
  };
}

export type ChatPanelState = ReturnType<typeof useChatPanel>;
