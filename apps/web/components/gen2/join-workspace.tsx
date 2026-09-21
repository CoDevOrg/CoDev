"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function JoinGen2Workspace({ token }: { token: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function join() {
    setBusy(true);
    setError("");
    const response = await fetch("/api/gen2/join", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    });
    const payload = (await response.json()) as {
      workspace?: { id: string };
      error?: string;
    };
    if (!response.ok || !payload.workspace) {
      setError(payload.error ?? "This invite link is no longer valid.");
      setBusy(false);
      return;
    }
    router.push(`/gen2/${payload.workspace.id}`);
    router.refresh();
  }

  return (
    <>
      <button
        className="primary-button"
        type="button"
        disabled={busy}
        onClick={() => void join()}
      >
        {busy ? "Joining…" : "Join workspace"}
      </button>
      {error ? (
        <p className="form-message error-copy" role="alert">
          {error}
        </p>
      ) : null}
    </>
  );
}
