"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { Paperclip } from "lucide-react";

import {
  importedConversationMessageSchema,
  type ImportedConversationMessage,
} from "@codev/contracts";

import { CHANNEL_MESSAGE_POLL_MS } from "@/lib/chat/team-chat-view";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/platform/utils";

import { avatarColor, avatarInitials } from "./shared-chat-avatar";
import { SharedChatComposer } from "./shared-chat-composer";

function messageLabel(message: ImportedConversationMessage) {
  if (message.authorName) return message.authorName;
  if (message.role === "assistant") return "Assistant";
  return message.role.charAt(0).toUpperCase() + message.role.slice(1);
}

function messageAlignClass(message: ImportedConversationMessage) {
  if (message.role === "user") return "self-start rounded-bl-sm bg-card";
  if (message.role === "assistant")
    return "self-end rounded-br-sm border-primary/25 bg-primary/8";
  return "self-center w-[90%] bg-violet/8";
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
    <section
      className="flex min-h-0 flex-1 flex-col"
      aria-label="Conversation messages"
    >
      <div
        role="log"
        aria-live="polite"
        aria-relevant="additions text"
        className="flex flex-1 flex-col gap-3 overflow-y-auto px-6 py-5"
      >
        <span className="mb-1 self-center rounded-full border border-border bg-card px-2.5 py-1 text-[10.5px] font-semibold text-muted-foreground">
          Live · {messages.length}{" "}
          {messages.length === 1 ? "message" : "messages"}
        </span>
        {messages.map((message) => {
          const label = messageLabel(message);
          const pending = message.generation?.status === "pending";
          const time = formatTime(message.createdAt);
          const isAssistant = message.role === "assistant";
          return (
            <motion.article
              key={message.sequence}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.22 }}
              aria-label={`${label} message ${message.sequence + 1}`}
              className={cn(
                "flex max-w-[78%] items-start gap-2.5 rounded-2xl border border-border px-4 py-3",
                messageAlignClass(message),
              )}
            >
              <Avatar className="mt-0.5 size-7 shrink-0">
                <AvatarFallback
                  style={
                    isAssistant
                      ? { background: "var(--color-primary)", color: "#f7f3e8" }
                      : { background: avatarColor(label), color: "#f7f3e8" }
                  }
                >
                  {isAssistant ? "C" : avatarInitials(label)}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-4">
                  <strong className="text-[12.5px] font-semibold">
                    {label}
                  </strong>
                  {time ? (
                    <time
                      suppressHydrationWarning
                      className="text-[10px] text-muted-foreground"
                    >
                      {time}
                    </time>
                  ) : null}
                </div>
                <div className="mt-1">
                  {isAssistant && message.generation ? (
                    <span className="mb-1 inline-block rounded-full border border-border bg-card px-2 py-0.5 text-[10px] text-muted-foreground">
                      {message.generation.model}
                    </span>
                  ) : null}
                  <p
                    aria-busy={pending}
                    className="m-0 text-[13.5px] leading-relaxed break-words whitespace-pre-wrap"
                  >
                    {pending ? (
                      <>
                        {label} is replying…
                        <span
                          aria-hidden="true"
                          className="ml-1.5 inline-flex gap-0.5 align-middle"
                        >
                          {[0, 1, 2].map((index) => (
                            <span
                              key={index}
                              style={{ animationDelay: `${index * 0.15}s` }}
                              className="size-1 animate-bounce rounded-full bg-muted-foreground"
                            />
                          ))}
                        </span>
                      </>
                    ) : (
                      message.text
                    )}
                  </p>
                  {message.artifacts.length ? (
                    <ul
                      aria-label="Message attachments"
                      className="mt-2 flex flex-wrap gap-1.5"
                    >
                      {message.artifacts.map((artifact) => (
                        <li
                          key={`${artifact.kind}-${artifact.sourceUrl}`}
                          className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1 text-[11px] text-muted-foreground"
                        >
                          <Paperclip aria-hidden="true" className="size-3" />
                          <span className="overflow-hidden text-ellipsis whitespace-nowrap">
                            {artifact.filename}
                          </span>
                          <small className="uppercase">{artifact.kind}</small>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              </div>
            </motion.article>
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
