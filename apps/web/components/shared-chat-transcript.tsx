"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Paperclip } from "lucide-react";

import type { ImportedConversationMessage } from "@codev/contracts";

import { CHANNEL_MESSAGE_POLL_MS } from "@/lib/team-chat-view";

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
  const requestInFlight = useRef(false);

  const addMessages = useCallback((incoming: ImportedConversationMessage[]) => {
    if (!incoming.length) return;
    latestSequence.current = Math.max(
      latestSequence.current,
      ...incoming.map((message) => message.sequence),
    );
    setMessages((current) => mergeRoomMessages(current, incoming));
  }, []);

  const refreshMessages = useCallback(
    async (signal?: AbortSignal) => {
      if (requestInFlight.current || document.visibilityState === "hidden") {
        return;
      }
      requestInFlight.current = true;
      try {
        const response = await fetch(
          `/api/rooms/${roomId}/messages?after=${latestSequence.current}`,
          { cache: "no-store", ...(signal ? { signal } : {}) },
        );
        if (!response.ok) return;
        const payload = (await response.json()) as {
          messages?: ImportedConversationMessage[];
        };
        addMessages(payload.messages ?? []);
      } catch {
        // Preserve the current transcript; the next polling tick can recover.
      } finally {
        requestInFlight.current = false;
      }
    },
    [addMessages, roomId],
  );

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setInterval(() => {
      void refreshMessages(controller.signal);
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

  return (
    <section className={styles.transcript} aria-label="Conversation messages">
      <span className={styles.liveStatus}>
        Live · {messages.length}{" "}
        {messages.length === 1 ? "message" : "messages"}
      </span>
      {messages.map((message) => (
        <article
          className={`${styles.message} ${messageClass(message)}`}
          key={message.sequence}
          aria-label={`${messageLabel(message)} message ${message.sequence + 1}`}
        >
          <strong>{messageLabel(message)}</strong>
          <p>{message.text}</p>
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
        </article>
      ))}
      <SharedChatComposer
        roomId={roomId}
        onMessageSent={(message) => addMessages([message])}
      />
    </section>
  );
}
