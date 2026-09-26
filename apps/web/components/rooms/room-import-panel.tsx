"use client";

import { type FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowRight,
  ExternalLink,
  Link2,
  LoaderCircle,
  MessageSquareText,
  Paperclip,
  ShieldCheck,
} from "lucide-react";

import type {
  ImportedConversation,
  ImportedConversationMessage,
} from "@codev/contracts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { MarkdownContent } from "@/components/markdown/markdown-content";
import { cn } from "@/lib/platform/utils";

type PreviewResponse = {
  conversation?: ImportedConversation;
  error?: string;
  code?: string;
};

type CreateRoomResponse = {
  room?: { id: string; href: string };
  error?: string;
};

function messageLabel(message: ImportedConversationMessage) {
  if (message.authorName) return message.authorName;
  if (message.role === "assistant") return "ChatGPT";
  return message.role.charAt(0).toUpperCase() + message.role.slice(1);
}

function messageAlignClass(message: ImportedConversationMessage) {
  if (message.role === "user") return "self-start rounded-bl-sm bg-card";
  if (message.role === "assistant")
    return "self-end rounded-br-sm border-primary/25 bg-primary/8";
  return "self-center w-[90%] bg-violet/8";
}

function formatTimestamp(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function RoomImportPanel({ open }: { open: boolean }) {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [conversation, setConversation] = useState<ImportedConversation | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createdRoom, setCreatedRoom] = useState<CreateRoomResponse["room"]>();

  async function previewConversation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!url.trim() || busy) return;

    setBusy(true);
    setError(null);
    setConversation(null);
    try {
      const response = await fetch("/api/conversation-imports/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });
      const payload = (await response
        .json()
        .catch(() => null)) as PreviewResponse | null;
      if (!response.ok || !payload?.conversation) {
        setError(
          payload?.error ??
            "The conversation could not be previewed. Check the link and try again.",
        );
        return;
      }
      setConversation(payload.conversation);
      setCreateError(null);
      setCreatedRoom(undefined);
    } catch {
      setError(
        "CoDev could not reach the preview service. Check your connection and try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function createRoom() {
    if (!conversation || creating) return;

    setCreating(true);
    setCreateError(null);
    try {
      const response = await fetch("/api/conversation-imports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: conversation.source.url }),
      });
      const payload = (await response
        .json()
        .catch(() => null)) as CreateRoomResponse | null;
      if (!response.ok || !payload?.room?.href) {
        setCreateError(
          payload?.error ??
            "The collaborative room could not be created. Please try again.",
        );
        return;
      }
      setCreatedRoom(payload.room);
      router.push(payload.room.href);
    } catch {
      setCreateError(
        "CoDev could not reach the room service. Check your connection and try again.",
      );
    } finally {
      setCreating(false);
    }
  }

  const artifactCount =
    conversation?.messages.reduce(
      (total, message) => total + message.artifacts.length,
      0,
    ) ?? 0;

  return (
    <AnimatePresence initial={false}>
      {open ? (
        <motion.section
          key="import-panel"
          aria-labelledby="import-chat-title"
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: 0.24, ease: "easeOut" }}
          className="overflow-hidden rounded-2xl border border-input bg-card shadow-xl shadow-foreground/10"
        >
          <div className="grid grid-cols-1 md:grid-cols-[360px_minmax(0,1fr)]">
            {/* Form column */}
            <div className="flex flex-col gap-4.5 border-b border-border p-6 md:border-r md:border-b-0">
              <div className="flex items-center gap-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-[11px] border border-primary/30 bg-primary/10 text-primary">
                  <MessageSquareText
                    aria-hidden="true"
                    className="size-[18px]"
                  />
                </div>
                <div>
                  <h2
                    id="import-chat-title"
                    className="m-0 text-[15.5px] font-semibold tracking-tight"
                  >
                    Preview a shared chat
                  </h2>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    ChatGPT links are supported in this first version.
                  </p>
                </div>
              </div>

              <form
                onSubmit={previewConversation}
                className="flex flex-col gap-3.5"
              >
                <div>
                  <label
                    htmlFor="conversation-share-url"
                    className="mb-1.5 block text-[11.5px] font-semibold text-muted-foreground"
                  >
                    Public share link
                  </label>
                  <div className="flex h-11 items-center gap-2 rounded-[10px] border border-input bg-card px-3.5">
                    <Link2
                      aria-hidden="true"
                      className="size-4 shrink-0 text-muted-foreground"
                    />
                    <Input
                      id="conversation-share-url"
                      type="url"
                      inputMode="url"
                      autoComplete="off"
                      spellCheck={false}
                      required
                      maxLength={2_048}
                      placeholder="https://chatgpt.com/share/…"
                      value={url}
                      disabled={busy}
                      onChange={(event) => setUrl(event.target.value)}
                      className="h-auto border-0 bg-transparent p-0 text-[13px] shadow-none focus-visible:ring-0"
                    />
                  </div>
                </div>

                <Button
                  type="submit"
                  disabled={busy || !url.trim()}
                  className="h-[42px] w-full rounded-[10px]"
                >
                  {busy ? (
                    <LoaderCircle
                      className="size-4 animate-spin"
                      aria-hidden="true"
                    />
                  ) : null}
                  {busy ? "Previewing…" : "Preview chat"}
                </Button>
              </form>

              <div className="flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
                <ShieldCheck aria-hidden="true" className="size-3.5 shrink-0" />
                Preview only. CoDev has not saved this conversation or created a
                room.
              </div>

              <div aria-live="polite" className="empty:hidden">
                {busy ? (
                  <p
                    role="status"
                    className="rounded-[9px] border border-border bg-muted px-3 py-2.5 text-[13px] text-muted-foreground"
                  >
                    Fetching and cleaning the shared transcript…
                  </p>
                ) : null}
                {error ? (
                  <p
                    role="alert"
                    className="rounded-[9px] border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-[13px] text-destructive"
                  >
                    {error}
                  </p>
                ) : null}
              </div>
            </div>

            {/* Preview column */}
            {conversation ? (
              <div
                aria-labelledby="conversation-preview-title"
                className="flex flex-col gap-4 p-6"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <span className="mb-1.5 block text-[10.5px] font-bold tracking-[0.1em] text-primary uppercase">
                      Read-only preview
                    </span>
                    <h3
                      id="conversation-preview-title"
                      className="m-0 text-[19px] font-semibold tracking-tight"
                    >
                      {conversation.title}
                    </h3>
                    <div className="mt-2.5 flex flex-wrap gap-1.5">
                      <Badge variant="outline">
                        {conversation.messages.length}{" "}
                        {conversation.messages.length === 1
                          ? "message"
                          : "messages"}
                      </Badge>
                      <Badge variant="outline">
                        {artifactCount}{" "}
                        {artifactCount === 1 ? "attachment" : "attachments"}
                      </Badge>
                      {conversation.source.model ? (
                        <Badge variant="outline">
                          {conversation.source.model}
                        </Badge>
                      ) : null}
                    </div>
                  </div>
                  <a
                    href={conversation.source.url}
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: "var(--color-muted-foreground)" }}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border px-2.5 py-1.5 text-xs hover:border-input"
                  >
                    Open original
                    <ExternalLink aria-hidden="true" className="size-3.5" />
                  </a>
                </div>

                <div
                  aria-live="polite"
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-muted/40 px-4 py-3"
                >
                  <div className="flex flex-col gap-0.5">
                    <strong className="text-[13px]">
                      {createdRoom
                        ? "Your collaborative room is ready."
                        : "Ready to make this collaborative?"}
                    </strong>
                    <span className="text-[11px] text-muted-foreground">
                      {createdRoom
                        ? "Open it now, or find it later from Rooms."
                        : "The cleaned transcript will be saved to a new room."}
                    </span>
                  </div>
                  {createdRoom ? (
                    <a
                      href={createdRoom.href}
                      style={{ color: "var(--color-background)" }}
                      className="inline-flex items-center gap-1.5 rounded-full bg-foreground px-3.5 py-2 text-xs font-semibold"
                    >
                      Open room
                      <ArrowRight aria-hidden="true" className="size-3.5" />
                    </a>
                  ) : (
                    <Button
                      type="button"
                      disabled={creating}
                      onClick={createRoom}
                      className="h-9 rounded-full px-3.5 text-xs"
                    >
                      {creating ? (
                        <LoaderCircle
                          className="size-3.5 animate-spin"
                          aria-hidden="true"
                        />
                      ) : null}
                      {creating
                        ? "Creating room…"
                        : "Create collaborative room"}
                      {!creating ? (
                        <ArrowRight aria-hidden="true" className="size-3.5" />
                      ) : null}
                    </Button>
                  )}
                </div>

                {createError ? (
                  <p role="alert" className="text-xs text-destructive">
                    {createError}
                  </p>
                ) : null}

                {conversation.warnings.length ? (
                  <div
                    role="status"
                    className="rounded-lg border border-violet/30 bg-violet/8 px-3.5 py-2.5 text-xs text-violet"
                  >
                    {conversation.warnings.map((warning) => (
                      <p
                        key={warning}
                        className="m-0 first:mt-0 [&:not(:first-child)]:mt-1"
                      >
                        {warning}
                      </p>
                    ))}
                  </div>
                ) : null}

                <div
                  aria-label="Conversation messages"
                  className="flex flex-col gap-2.5"
                >
                  {conversation.messages.map((message) => {
                    const timestamp = formatTimestamp(message.createdAt);
                    return (
                      <article
                        key={message.sequence}
                        aria-label={`${messageLabel(message)} message ${message.sequence + 1}`}
                        className={cn(
                          "flex max-w-[80%] flex-col gap-0.5 rounded-[13px] border border-border px-3.5 py-2.5",
                          messageAlignClass(message),
                        )}
                      >
                        <div className="flex items-baseline justify-between gap-4">
                          <strong className="text-[10.5px] text-muted-foreground">
                            {messageLabel(message)}
                          </strong>
                          {timestamp ? (
                            <time className="text-[10px] text-muted-foreground/70">
                              {timestamp}
                            </time>
                          ) : null}
                        </div>
                        <MarkdownContent
                          text={message.text}
                          className="text-[12.5px]"
                        />
                        {message.artifacts.length ? (
                          <ul
                            aria-label="Message attachments"
                            className="mt-1.5 flex flex-wrap gap-1.5"
                          >
                            {message.artifacts.map((artifact) => (
                              <li
                                key={`${artifact.kind}-${artifact.sourceUrl}`}
                                className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1 text-[11px] text-muted-foreground"
                              >
                                <Paperclip
                                  aria-hidden="true"
                                  className="size-3"
                                />
                                <span className="overflow-hidden text-ellipsis whitespace-nowrap">
                                  {artifact.filename}
                                </span>
                                <small className="uppercase">
                                  {artifact.kind}
                                </small>
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </article>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </div>
        </motion.section>
      ) : null}
    </AnimatePresence>
  );
}
