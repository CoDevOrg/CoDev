"use client";

import { type FormEvent, useState } from "react";
import {
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

import styles from "./conversation-import-preview.module.css";

type PreviewResponse = {
  conversation?: ImportedConversation;
  error?: string;
  code?: string;
};

function messageLabel(message: ImportedConversationMessage) {
  if (message.authorName) return message.authorName;
  if (message.role === "assistant") return "ChatGPT";
  return message.role.charAt(0).toUpperCase() + message.role.slice(1);
}

function messageClass(message: ImportedConversationMessage) {
  if (message.role === "user") return styles.userMessage;
  if (message.role === "assistant") return styles.assistantMessage;
  return styles.contextMessage;
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

export function ConversationImportPreview() {
  const [url, setUrl] = useState("");
  const [conversation, setConversation] = useState<ImportedConversation | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
    } catch {
      setError(
        "CoDev could not reach the preview service. Check your connection and try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  const artifactCount =
    conversation?.messages.reduce(
      (total, message) => total + message.artifacts.length,
      0,
    ) ?? 0;

  return (
    <div className={styles.page}>
      <header className={styles.intro}>
        <span className={styles.eyebrow}>Portable conversations</span>
        <h1>Bring a chat into CoDev.</h1>
        <p>
          Paste a public ChatGPT share link to see the clean conversation before
          turning it into a collaborative room.
        </p>
      </header>

      <section className={styles.formCard} aria-labelledby="import-chat-title">
        <div className={styles.formHeading}>
          <div className={styles.providerIcon} aria-hidden="true">
            <MessageSquareText />
          </div>
          <div>
            <h2 id="import-chat-title">Preview a shared chat</h2>
            <p>ChatGPT links are supported in this first version.</p>
          </div>
        </div>

        <form onSubmit={previewConversation} className={styles.form}>
          <label htmlFor="conversation-share-url">Public share link</label>
          <div className={styles.inputRow}>
            <div className={styles.inputWrap}>
              <Link2 aria-hidden="true" />
              <input
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
              />
            </div>
            <button type="submit" disabled={busy || !url.trim()}>
              {busy ? (
                <LoaderCircle className={styles.spinner} aria-hidden="true" />
              ) : null}
              {busy ? "Previewing…" : "Preview chat"}
            </button>
          </div>
        </form>

        <div className={styles.safetyNote}>
          <ShieldCheck aria-hidden="true" />
          <span>
            Preview only. CoDev has not saved this conversation or created a
            room.
          </span>
        </div>

        <div className={styles.statusRegion} aria-live="polite">
          {busy ? (
            <p className={styles.loadingStatus} role="status">
              Fetching and cleaning the shared transcript…
            </p>
          ) : null}
          {error ? (
            <p className={styles.error} role="alert">
              {error}
            </p>
          ) : null}
        </div>
      </section>

      {conversation ? (
        <section
          className={styles.preview}
          aria-labelledby="conversation-preview-title"
        >
          <header className={styles.previewHeader}>
            <div>
              <span className={styles.previewLabel}>Read-only preview</span>
              <h2 id="conversation-preview-title">{conversation.title}</h2>
              <div className={styles.previewMeta}>
                <span>
                  {conversation.messages.length}{" "}
                  {conversation.messages.length === 1 ? "message" : "messages"}
                </span>
                <span>
                  {artifactCount}{" "}
                  {artifactCount === 1 ? "attachment" : "attachments"}
                </span>
                {conversation.source.model ? (
                  <span>{conversation.source.model}</span>
                ) : null}
              </div>
            </div>
            <a
              href={conversation.source.url}
              target="_blank"
              rel="noreferrer"
              className={styles.sourceLink}
            >
              Open original
              <ExternalLink aria-hidden="true" />
            </a>
          </header>

          {conversation.warnings.length ? (
            <div className={styles.warnings} role="status">
              {conversation.warnings.map((warning) => (
                <p key={warning}>{warning}</p>
              ))}
            </div>
          ) : null}

          <div className={styles.transcript} aria-label="Conversation messages">
            {conversation.messages.map((message) => {
              const timestamp = formatTimestamp(message.createdAt);
              return (
                <article
                  className={`${styles.message} ${messageClass(message)}`}
                  key={message.sequence}
                  aria-label={`${messageLabel(message)} message ${message.sequence + 1}`}
                >
                  <div className={styles.messageMeta}>
                    <strong>{messageLabel(message)}</strong>
                    {timestamp ? <time>{timestamp}</time> : null}
                  </div>
                  <p className={styles.messageBody}>{message.text}</p>
                  {message.artifacts.length ? (
                    <ul
                      className={styles.artifacts}
                      aria-label="Message attachments"
                    >
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
              );
            })}
          </div>
        </section>
      ) : null}
    </div>
  );
}
