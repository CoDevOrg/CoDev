"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Paperclip } from "lucide-react";

import {
  importedConversationMessageSchema,
  type ImportedConversationMessage,
} from "@codev/contracts";

import { CHANNEL_MESSAGE_POLL_MS } from "@/lib/team-chat-view";

import { avatarColor, avatarInitials } from "./shared-chat-avatar";
import { SharedChatComposer } from "./shared-chat-composer";
import styles from "./shared-chat-room.module.css";

function messageLabel(message: ImportedConversationMessage) {
  if (message.authorName) return message.authorName;
  if (message.role === "assistant") return "Assistant";
  return message.role.charAt(0).toUpperCase() + message.role.slice(1);
}

function messageClass(message: ImportedConversationMessage) {
  if (message.role === "user") return styles.userMessage;
  if (message.role === "assistant") return styles.assistantMessage;
  return styles.contextMessage;
}

function formatTime(createdAt: string | null | undefined) {
  if (!createdAt) return null;
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function mergeRoomMessages(
  current: ImportedConversationMessage[],
  incoming: ImportedConversationMessage[],
) {
  const bySequence = new Map(
    current.map((message) => [message.sequence, message]),
  );
  for (const message of incoming) bySequence.set(message.sequence, message);
  return [...bySequence.values()].sort((a, b) => a.sequence - b.sequence);
}

export function SharedChatTranscript({
  roomId,
  initialMessages,
}: {
  roomId: string;
  initialMessages: ImportedConversationMessage[];
}) {
  const [messages, setMessages] = useState(initialMessages);
  const latestSequence = useRef(initialMessages.at(-1)?.sequence ?? -1);
  const streamConnected = useRef(false);
  const requestInFlight = useRef(false);
  const pendingSequence = useRef<number | null>(
    initialMessages.find((message) => message.generation?.status === "pending")
      ?.sequence ?? null,
  );

  const addMessages = useCallback((incoming: ImportedConversationMessage[]) => {
    if (!incoming.length) return;
    latestSequence.current = Math.max(
      latestSequence.current,
      ...incoming.map((message) => message.sequence),
    );
    setMessages((current) => {
      const merged = mergeRoomMessages(current, incoming);
      pendingSequence.current =
        merged.find((message) => message.generation?.status === "pending")
          ?.sequence ?? null;
      return merged;
    });
  }, []);

  const refreshMessages = useCallback(
    async (signal?: AbortSignal) => {
      if (requestInFlight.current || document.visibilityState === "hidden") {
        return;
      }
      requestInFlight.current = true;
      try {
        let after =
          pendingSequence.current === null
            ? latestSequence.current
            : Math.min(latestSequence.current, pendingSequence.current - 1);
        for (;;) {
          const response = await fetch(
            `/api/rooms/${roomId}/messages?after=${after}`,
            { cache: "no-store", ...(signal ? { signal } : {}) },
          );
          if (!response.ok) return;
          const payload = (await response.json()) as {
            messages?: ImportedConversationMessage[];
          };
          const parsed = importedConversationMessageSchema
            .array()
            .safeParse(payload.messages);
          if (!parsed.success) return;
          addMessages(parsed.data);
          const next = parsed.data.at(-1)?.sequence;
          if (
            parsed.data.length < 200 ||
            next === undefined ||
            next <= after ||
            signal?.aborted
          )
            break;
          after = next;
        }
      } catch {
        // Preserve the current transcript; the next polling tick can recover.
      } finally {
        requestInFlight.current = false;
      }
    },
    [addMessages, roomId],
  );

  // Live updates are pushed over Server-Sent Events. Polling stays as the
  // fallback: it runs while the stream is disconnected, and a refresh on tab
  // refocus keeps the transcript correct even when the stream is healthy.
  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setInterval(() => {
      if (!streamConnected.current) void refreshMessages(controller.signal);
    }, CHANNEL_MESSAGE_POLL_MS);
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void refreshMessages(controller.signal);
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      controller.abort();
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [refreshMessages]);

  useEffect(() => {
    if (typeof EventSource === "undefined") return;
    const source = new EventSource(
      `/api/rooms/${roomId}/stream?after=${latestSequence.current}`,
    );
    source.onopen = () => {
      streamConnected.current = true;
    };
    source.onmessage = (event) => {
      try {
        const parsed = importedConversationMessageSchema.safeParse(
          JSON.parse(event.data),
        );
        if (parsed.success) addMessages([parsed.data]);
      } catch {
        // Ignore a malformed frame; the next one (or a poll) recovers.
      }
    };
    source.onerror = () => {
      // The browser reconnects on its own; polling covers the gap meanwhile.
      streamConnected.current = false;
    };
    return () => {
      streamConnected.current = false;
      source.close();
    };
  }, [roomId, addMessages]);

  return (
    <section className={styles.transcript} aria-label="Conversation messages">
      <div
        className={styles.messageLog}
        role="log"
        aria-live="polite"
        aria-relevant="additions text"
      >
        <span className={styles.liveStatus}>
          Live · {messages.length}{" "}
          {messages.length === 1 ? "message" : "messages"}
        </span>
        {messages.map((message) => {
          const label = messageLabel(message);
          const pending = message.generation?.status === "pending";
          const time = formatTime(message.createdAt);
          const isAssistant = message.role === "assistant";
          return (
            <article
              className={`${styles.message} ${messageClass(message)} ${
                pending ? styles.pending : ""
              }`}
              key={message.sequence}
              aria-label={`${label} message ${message.sequence + 1}`}
            >
              <span
                className={styles.avatar}
                aria-hidden="true"
                style={
                  isAssistant ? undefined : { background: avatarColor(label) }
                }
              >
                {isAssistant ? "C" : avatarInitials(label)}
              </span>
              <div>
                <div className={styles.msgHead}>
                  <strong>{label}</strong>
                  {time ? <time suppressHydrationWarning>{time}</time> : null}
                </div>
                <div className={styles.body}>
                  {isAssistant && message.generation ? (
                    <span className={styles.modelTag}>
                      {message.generation.model}
                    </span>
                  ) : null}
                  <p aria-busy={pending}>
                    {pending ? (
                      <>
                        {label} is replying…
                        <span className={styles.beads} aria-hidden="true">
                          <i />
                          <i />
                          <i />
                        </span>
                      </>
                    ) : (
                      message.text
                    )}
                  </p>
                  {message.artifacts.length ? (
                    <ul aria-label="Message attachments">
                      {message.artifacts.map((artifact) => (
                        <li key={`${artifact.kind}-${artifact.sourceUrl}`}>
                          <Paperclip aria-hidden="true" />
                          <span>{artifact.filename}</span>
                          <small>{artifact.kind}</small>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              </div>
            </article>
          );
        })}
      </div>
      <SharedChatComposer
        roomId={roomId}
        onMessageSent={(message) => addMessages([message])}
      />
    </section>
  );
}
