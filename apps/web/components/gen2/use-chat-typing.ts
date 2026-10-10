"use client";

import { useEffect, useRef, useState } from "react";

import {
  useRealtimeEvent,
  useWorkspaceRealtime,
} from "./use-workspace-realtime";

const SEND_EVERY_MS = 2_000;
/** A typing notice lapses this long after the member's last keystroke. */
const SHOWN_FOR_MS = 4_000;

/** Tells other members this member is writing in `chatId`, at most every 2s. */
export function useSendTyping(chatId: string | null, text: string) {
  const { send } = useWorkspaceRealtime();
  const lastSent = useRef(0);
  const active = Boolean(chatId && text.trim());
  useEffect(() => {
    if (!active || !chatId) return;
    const now = Date.now();
    if (now - lastSent.current < SEND_EVERY_MS) return;
    lastSent.current = now;
    send({ type: "typing", chatId });
  }, [active, chatId, text, send]);
}

/** The other members writing in `chatId` right now, by user id. */
export function useTypers(chatId: string | null) {
  const { currentUserId } = useWorkspaceRealtime();
  const [typers, setTypers] = useState<Map<string, number>>(new Map());
  useRealtimeEvent("typing", (event) => {
    if (event.chatId !== chatId || event.userId === currentUserId) return;
    setTypers((current) =>
      new Map(current).set(event.userId, Date.now() + SHOWN_FOR_MS),
    );
  });
  useRealtimeEvent("chat.message", (event) => {
    const author = event.message?.authorUserId;
    if (!author || !typers.has(author)) return;
    setTypers((current) => {
      const next = new Map(current);
      next.delete(author);
      return next;
    });
  });
  useEffect(() => {
    if (!typers.size) return;
    const soonest = Math.min(...typers.values());
    const timer = window.setTimeout(
      () =>
        setTypers(
          (current) =>
            new Map([...current].filter(([, until]) => until > Date.now())),
        ),
      Math.max(0, soonest - Date.now()) + 50,
    );
    return () => window.clearTimeout(timer);
  }, [typers]);
  return [...typers.keys()];
}
