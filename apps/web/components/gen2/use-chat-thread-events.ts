"use client";

import type { Gen2Chat, Gen2ChatMessage } from "@codev/contracts";

import { useRealtimeEvent, useRealtimeResync } from "./use-workspace-realtime";

/** Puts `chat` first, replacing any copy already listed. */
export function upsertChat(chats: Gen2Chat[], chat: Gen2Chat) {
  return [chat, ...chats.filter((entry) => entry.id !== chat.id)];
}

/** Adds a saved message once, keeping the thread in send order. */
export function withSavedMessage(
  messages: Gen2ChatMessage[],
  message: Gen2ChatMessage,
) {
  if (messages.some((entry) => entry.id === message.id)) return null;
  const saved = messages.filter((entry) => !entry.id.startsWith("pending-"));
  return [...saved, message];
}

/**
 * Keeps the chat list and the open thread current with what other members
 * and agents do, and reloads both after a reconnect.
 */
export function useChatThreadEvents(input: {
  chatId: string | null;
  updateChats: (update: (chats: Gen2Chat[]) => Gen2Chat[]) => void;
  addMessage: (chatId: string, message: Gen2ChatMessage | null) => void;
  reload: () => void;
}) {
  const { chatId, updateChats, addMessage, reload } = input;
  useRealtimeEvent("chat.created", (event) =>
    updateChats((chats) =>
      chats.some((chat) => chat.id === event.chat.id)
        ? chats
        : upsertChat(chats, event.chat),
    ),
  );
  useRealtimeEvent("chat.updated", (event) =>
    updateChats((chats) =>
      chats.map((chat) =>
        chat.id === event.chat.id ? { ...chat, ...event.chat } : chat,
      ),
    ),
  );
  useRealtimeEvent("chat.message", (event) => {
    updateChats((chats) => {
      const chat = chats.find((entry) => entry.id === event.chatId);
      if (!chat) return chats;
      return upsertChat(chats, {
        ...chat,
        title: event.title ?? chat.title,
        updatedAt: event.updatedAt,
      });
    });
    if (event.chatId === chatId) addMessage(event.chatId, event.message);
  });
  useRealtimeEvent("turn.settled", (event) => {
    if (event.chatId === chatId) addMessage(event.chatId, event.message);
  });
  useRealtimeResync(reload);
}
