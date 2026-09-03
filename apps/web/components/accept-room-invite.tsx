"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function AcceptRoomInvite({ token }: { token: string }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function accept() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/room-invites/${token}/accept`, {
        method: "POST",
      });
      const payload = (await response.json().catch(() => null)) as {
        roomId?: string;
        error?: string;
      } | null;
      if (!response.ok || !payload?.roomId) {
        setError(
          payload?.error ?? "The room invitation could not be accepted.",
        );
        return;
      }
      router.push(`/rooms/${payload.roomId}`);
      router.refresh();
    } catch {
      setError("CoDev could not join the room. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        className="primary-button"
        type="button"
        disabled={busy}
        onClick={() => void accept()}
      >
        {busy ? "Joining…" : "Join room"}
      </button>
      {error ? (
        <p className="form-message error-copy" role="alert">
          {error}
        </p>
      ) : null}
    </>
  );
}
