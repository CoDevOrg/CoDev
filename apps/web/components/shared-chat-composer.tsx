"use client";

import { type FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, Send } from "lucide-react";

import styles from "./shared-chat-room.module.css";

type MessageResponse = { error?: string };

export function SharedChatComposer({ roomId }: { roomId: string }) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = body.trim();
    if (!message || sending) return;

    setSending(true);
    setError(null);
    try {
      const response = await fetch(`/api/rooms/${roomId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: message }),
      });
      const payload = (await response
        .json()
        .catch(() => null)) as MessageResponse | null;
      if (!response.ok) {
        setError(payload?.error ?? "The message could not be sent.");
        return;
      }
      setBody("");
      router.refresh();
    } catch {
      setError("CoDev could not reach the room. Please try again.");
    } finally {
      setSending(false);
    }
  }

  return (
    <form className={styles.composer} onSubmit={sendMessage}>
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
          {sending ? "Sending…" : "Send"}
        </button>
      </div>
      {error ? (
        <p className={styles.composerError} role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}
