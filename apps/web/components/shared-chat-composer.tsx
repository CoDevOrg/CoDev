"use client";

import { type FormEvent, useState, useEffect } from "react";
import { z } from "zod";
import { LoaderCircle, Send } from "lucide-react";

import {
  importedConversationMessageSchema,
  type ImportedConversationMessage,
} from "@codev/contracts";

import styles from "./shared-chat-room.module.css";

type MessageResponse = {
  message?: ImportedConversationMessage;
  reply?: ImportedConversationMessage;
  error?: string;
};

const optionsSchema = z.object({
  options: z.array(
    z.object({
      provider: z.enum(["claude", "codex"]),
      models: z.array(z.string()),
    }),
  ),
});

export function SharedChatComposer({
  roomId,
  onMessageSent,
}: {
  roomId: string;
  onMessageSent: (message: ImportedConversationMessage) => void;
}) {
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [options, setOptions] = useState<
    z.infer<typeof optionsSchema>["options"]
  >([]);
  const [provider, setProvider] = useState("claude");
  const [model, setModel] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch(`/api/rooms/${roomId}/reply-options`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error();
        const payload = optionsSchema.parse(await response.json());
        if (controller.signal.aborted) return;
        setOptions(payload.options);
        setProvider(payload.options[0]?.provider ?? "claude");
        setModel(payload.options[0]?.models[0] ?? "");
      } catch {
        /* Posting remains available when connections cannot load. */
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [roomId]);

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = body.trim();
    if (!message || sending) return;

    setSending(true);
    setError(null);
    const askAI =
      (event.nativeEvent as SubmitEvent).submitter?.getAttribute("value") ===
      "ai";
    try {
      const response = await fetch(`/api/rooms/${roomId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          body: message,
          ...(askAI ? { reply: { provider, model } } : {}),
        }),
      });
      const payload = (await response
        .json()
        .catch(() => null)) as MessageResponse | null;
      if (
        !response.ok ||
        !importedConversationMessageSchema.safeParse(payload?.message).success
      ) {
        setError(payload?.error ?? "The message could not be sent.");
        return;
      }
      setBody("");
      onMessageSent(payload!.message!);
      const reply = importedConversationMessageSchema.safeParse(payload?.reply);
      if (reply.success) onMessageSent(reply.data);
    } catch {
      setError("CoDev could not reach the room. Please try again.");
    } finally {
      setSending(false);
    }
  }

  return (
    <form
      className={styles.composer}
      onSubmit={sendMessage}
      aria-busy={sending}
    >
      <label htmlFor="room-message">Add to the conversation</label>
      <div>
        <textarea
          id="room-message"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder="Write a message…"
          maxLength={20_000}
          rows={3}
          disabled={sending}
        />
        <button type="submit" disabled={sending || !body.trim()}>
          {sending ? (
            <LoaderCircle className={styles.spinner} aria-hidden="true" />
          ) : (
            <Send aria-hidden="true" />
          )}
          {sending ? "Sending…" : "Post"}
        </button>
      </div>
      <div className={styles.replyControls}>
        {options.length ? (
          <>
            <label>
              Provider
              <select
                value={provider}
                disabled={sending}
                onChange={(event) => {
                  setProvider(event.target.value);
                  setModel(
                    options.find(
                      (option) => option.provider === event.target.value,
                    )?.models[0] ?? "",
                  );
                }}
              >
                {options.map((option) => (
                  <option key={option.provider} value={option.provider}>
                    {option.provider === "claude" ? "Claude" : "Codex"}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Model
              <select
                value={model}
                disabled={sending}
                onChange={(event) => setModel(event.target.value)}
              >
                {(
                  options.find((option) => option.provider === provider)
                    ?.models ?? []
                ).map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="submit"
              value="ai"
              disabled={sending || !body.trim() || !model}
            >
              Ask AI
            </button>
          </>
        ) : (
          <span>
            {loading ? (
              "Loading subscriptions…"
            ) : (
              <>
                To ask AI,{" "}
                <a href="/settings/personal/providers">
                  connect your subscription
                </a>
                .
              </>
            )}
          </span>
        )}
      </div>
      {options.length ? (
        <p className={styles.replyHint}>
          Replies use your subscription and recent room history.
        </p>
      ) : null}
      {error ? (
        <p className={styles.composerError} role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}
