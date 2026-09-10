"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Paperclip } from "lucide-react";

import {
  importedConversationMessageSchema,
  type ImportedConversationMessage,
} from "@codev/contracts";

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
      <div
        className={styles.messageLog}
        role="log"
        aria-live="polite"
        aria-relevant="additions text"
      >
        {messages.map((message) => (
          <article
            className={`${styles.message} ${messageClass(message)}`}
            key={message.sequence}
            aria-label={`${messageLabel(message)} message ${message.sequence + 1}`}
          >
            <strong>{messageLabel(message)}</strong>
            {message.generation ? (
              <small className={styles.replyHint}>
                {message.generation.model}
              </small>
            ) : null}
            <p aria-busy={message.generation?.status === "pending"}>
              {message.generation?.status === "pending"
                ? `${messageLabel(message)} is replying…`
                : message.text}
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
          </article>
        ))}
      </div>
      <SharedChatComposer
        roomId={roomId}
        onMessageSent={(message) => addMessages([message])}
      />
    </section>
  );
}
