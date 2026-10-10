"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  Gen2Chat,
  Gen2ChatDetail,
  Gen2ChatMessage,
} from "@codev/contracts";

import {
  upsertChat,
  useChatThreadEvents,
  withSavedMessage,
} from "./use-chat-thread-events";

export type ChatThread = { messages: Gen2ChatMessage[] };

/** Keeps optimistic messages the server has not written back yet. */
function mergeThread(current: ChatThread, saved: Gen2ChatMessage[]) {
  const pending = current.messages.filter(
    (message) =>
      message.id.startsWith("pending-") &&
      !saved.some(
        (entry) =>
          entry.role === "user" &&
          entry.body === message.body &&
          Date.parse(entry.createdAt) >= Date.parse(message.createdAt) - 5_000,
      ),
  );
  return { messages: [...saved, ...pending] };
}

/**
 * The workspace's chats and the selected chat's saved messages. A switch
 * clears the previous chat at once, so it never shows while the next loads.
 */
export function useChatThread({
  workspaceId,
  activeChatId,
  onChatsChange,
  onSelectChatId,
}: {
  workspaceId: string;
  activeChatId?: string | null | undefined;
  onChatsChange?: ((chats: Gen2Chat[]) => void) | undefined;
  onSelectChatId?: ((chatId: string) => void) | undefined;
}) {
  const [chats, setChats] = useState<Gen2Chat[]>([]);
  const [chatId, setChatId] = useState<string | null>(activeChatId ?? null);
  const [thread, setThread] = useState<ChatThread>({ messages: [] });
  // The chat whose saved messages `thread` holds.
  const [threadChatId, setThreadChatId] = useState<string | null>(null);
  const [switchingChat, setSwitchingChat] = useState(false);
  const [importedFrom, setImportedFrom] =
    useState<Gen2ChatDetail["importedFrom"]>(null);
  if (activeChatId && activeChatId !== chatId) setChatId(activeChatId);
  if (!chatId && thread.messages.length > 0) setThread({ messages: [] });
  if (threadChatId && chatId !== threadChatId) {
    setThreadChatId(null);
    setSwitchingChat(true);
    setThread({ messages: [] });
    setImportedFrom(null);
  }

  const chatIdRef = useRef(chatId);
  const activeChatIdRef = useRef(activeChatId);
  const chatsRef = useRef(chats);
  useEffect(() => {
    chatIdRef.current = chatId;
    activeChatIdRef.current = activeChatId;
    chatsRef.current = chats;
  }, [chatId, activeChatId, chats]);

  const loadChats = useCallback(async () => {
    const response = await fetch(`/api/gen2/workspaces/${workspaceId}/chats`);
    if (!response.ok) return;
    const payload = (await response.json()) as { chats?: Gen2Chat[] };
    const fetchedChats = payload.chats ?? [];
    setChats(fetchedChats);
    onChatsChange?.(fetchedChats);
    const selectedId = activeChatIdRef.current;
    const targetId = selectedId ?? fetchedChats[0]?.id ?? null;
    setChatId((current) => current ?? targetId);
    if (targetId && !selectedId) onSelectChatId?.(targetId);
  }, [workspaceId, onChatsChange, onSelectChatId]);

  useEffect(() => {
    const timeout = setTimeout(() => void loadChats(), 0);
    return () => clearTimeout(timeout);
  }, [loadChats]);

  const loadThread = useCallback(
    async (id: string) => {
      const response = await fetch(
        `/api/gen2/workspaces/${workspaceId}/chats/${id}`,
      );
      const payload = response.ok
        ? ((await response.json()) as { chat?: Gen2ChatDetail })
        : null;
      // The member switched chats while this one was loading.
      if (id !== chatIdRef.current) return;
      setThreadChatId(id);
      setSwitchingChat(false);
      if (!payload) return;
      setImportedFrom(payload.chat?.importedFrom ?? null);
      setThread((current) =>
        mergeThread(current, payload.chat?.messages ?? []),
      );
    },
    [workspaceId],
  );

  useEffect(() => {
    if (!chatId) return;
    const timeout = setTimeout(() => void loadThread(chatId), 0);
    return () => clearTimeout(timeout);
  }, [chatId, loadThread]);

  useChatThreadEvents({
    chatId,
    updateChats: (update) => {
      const next = update(chatsRef.current);
      if (next === chatsRef.current) return;
      chatsRef.current = next;
      setChats(next);
      onChatsChange?.(next);
    },
    addMessage: (id, message) => {
      if (!message) return void loadThread(id);
      setThread((current) => {
        const saved = withSavedMessage(current.messages, message);
        return saved ? mergeThread(current, saved) : current;
      });
    },
    reload: () => {
      void loadChats();
      if (chatIdRef.current) void loadThread(chatIdRef.current);
    },
  });

  /** Selects a chat this panel just created, with nothing to load. */
  function addChat(chat: Gen2Chat) {
    const next = upsertChat(chats, chat);
    setChats(next);
    setChatId(chat.id);
    setThread({ messages: [] });
    setThreadChatId(chat.id);
    onChatsChange?.(next);
    onSelectChatId?.(chat.id);
  }

  return {
    chats,
    chatId,
    setChatId,
    thread,
    setThread,
    switchingChat,
    importedFrom,
    loadChats,
    loadThread,
    addChat,
  };
}
