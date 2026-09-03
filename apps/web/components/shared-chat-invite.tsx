"use client";

import { useState } from "react";
import { Check, Copy, Link2, LoaderCircle } from "lucide-react";

import styles from "./shared-chat-room.module.css";

type InviteResponse = {
  inviteUrl?: string;
  expiresAt?: string;
  error?: string;
};

export function SharedChatInvite({ roomId }: { roomId: string }) {
  const [inviteUrl, setInviteUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");

  async function createInvite() {
    setBusy(true);
    setError("");
    setCopied(false);
    try {
      const response = await fetch(`/api/rooms/${roomId}/invites`, {
        method: "POST",
      });
      const payload = (await response
        .json()
        .catch(() => null)) as InviteResponse | null;
      if (!response.ok || !payload?.inviteUrl) {
        setError(payload?.error ?? "The invite link could not be created.");
        return;
      }
      setInviteUrl(payload.inviteUrl);
    } catch {
      setError("CoDev could not create an invite link. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function copyInvite() {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      setError("");
    } catch {
      setError("Copy failed. Select and copy the link manually.");
    }
  }

  return (
    <div className={styles.inviteControl}>
      <button type="button" disabled={busy} onClick={() => void createInvite()}>
        {busy ? (
          <LoaderCircle className={styles.spinner} aria-hidden="true" />
        ) : (
          <Link2 aria-hidden="true" />
        )}
        {busy ? "Creating…" : "Invite people"}
      </button>
      {inviteUrl ? (
        <div className={styles.inviteResult} aria-live="polite">
          <div>
            <strong>Invite link ready</strong>
            <span>It expires in 24 hours and works once.</span>
          </div>
          <code>{inviteUrl}</code>
          <button type="button" onClick={() => void copyInvite()}>
            {copied ? (
              <Check aria-hidden="true" />
            ) : (
              <Copy aria-hidden="true" />
            )}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      ) : null}
      {error ? (
        <p className={styles.inviteError} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
