"use client";

import { useEffect, type RefObject } from "react";
import type {
  Gen2AgentProviderName,
  Gen2Chat,
  Gen2PossibleDuplicateTask,
  Gen2WorkspaceDetail,
} from "@codev/contracts";

import { canRunGen2Agent } from "@/lib/gen2/agent-policy";
import { createChat } from "./chat-turn-client";
import { useChatModels } from "./use-chat-models";
import { useChatSend } from "./use-chat-send";
import { useChatThread } from "./use-chat-thread";
import { useChatTurn, type ChatTurnOutcome } from "./use-chat-turn";
import { useGen2ChatScroll } from "./use-gen2-chat-scroll";
import type { WorkspaceAgentContextValue } from "./workspace-controller";

export type ChatSessionInput = {
  workspace: Gen2WorkspaceDetail;
  agentContext: WorkspaceAgentContextValue | null;
  transcriptRef: RefObject<HTMLDivElement | null>;
  onRunningChange: (running: boolean) => void;
  onFilesChanged: () => void;
  /** Brings the machine up; resolves false if it could not. */
  onNeedsMachine: () => Promise<boolean>;
  worktreeId?: string | undefined;
  activeChatId?: string | null | undefined;
  onSelectChatId?: ((chatId: string) => void) | undefined;
  onChatsChange?: ((chats: Gen2Chat[]) => void) | undefined;
  activeProvider?: Gen2AgentProviderName | undefined;
  connectedProviders?: Gen2AgentProviderName[] | undefined;
  onActiveProviderChange?:
    | ((provider: Gen2AgentProviderName) => void)
    | undefined;
  /** Bumped when the member's accounts change; reloads provider state. */
  providersRevision?: number | undefined;
  setError: (message: string) => void;
  setPossibleDuplicate: (duplicate: Gen2PossibleDuplicateTask | null) => void;
  onSettled: (outcome: ChatTurnOutcome) => void;
};

/**
 * The chat's data and turn machinery: agent and models, chats and the
 * thread, the live turn, scrolling, and starting turns. The panel adds the
 * composer, goal and actions on top.
 */
export function useChatSession(input: ChatSessionInput) {
  const { workspace, setError } = input;
  const models = useChatModels({
    ...input,
    workspaceId: workspace.id,
    providersRevision: input.providersRevision ?? 0,
  });
  const thread = useChatThread({ ...input, workspaceId: workspace.id });
  const { chatId } = thread;
  const messages = thread.thread.messages;
  const turn = useChatTurn({
    workspaceId: workspace.id,
    loadThread: thread.loadThread,
    loadChats: thread.loadChats,
    onFilesChanged: input.onFilesChanged,
    refreshProvider: models.refreshProvider,
    setError,
    setChatId: thread.setChatId,
    onSettled: input.onSettled,
  });
  const scroll = useGen2ChatScroll(
    input.transcriptRef,
    `${chatId ?? ""}:${messages.length}:${turn.items.length}:${turn.liveReply.length}`,
  );
  const { pinToLatest } = scroll;
  /** The model a message runs on: its override's, else the chat's. */
  const modelFor = (choice: Gen2AgentProviderName | null) =>
    choice ? models.modelFor(choice) : models.currentModelItem;
  const sender = useChatSend({
    ...input,
    workspaceId: workspace.id,
    ready: canRunGen2Agent(workspace.status),
    chatId,
    setChatId: thread.setChatId,
    running: turn.running,
    targetFor: (choice) => ({
      provider: choice ?? models.agent,
      model: modelFor(choice)?.id,
    }),
    setThread: thread.setThread,
    loadThread: thread.loadThread,
    loadChats: thread.loadChats,
    follow: turn.follow,
    refreshProvider: models.refreshProvider,
    pinToLatest,
  });
  const { onRunningChange } = input;

  useEffect(() => {
    pinToLatest();
  }, [chatId, pinToLatest]);

  useEffect(
    () => onRunningChange(turn.running || sender.starting),
    [turn.running, sender.starting, onRunningChange],
  );

  async function newChat(choice: Gen2AgentProviderName) {
    models.selectProvider(choice);
    const chat = await createChat(workspace.id, choice).catch(() => null);
    if (!chat) return;
    thread.addChat(chat);
    pinToLatest();
  }

  return {
    models,
    thread,
    turn,
    scroll,
    sender,
    busy: turn.running || sender.starting || sender.waking,
    modelFor,
    newChat,
  };
}
