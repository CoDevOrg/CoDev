"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function AcceptInvite({ token }: { token: string }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function accept() {
    setBusy(true);
    setError("");
    const response = await fetch(`/api/invites/${token}/accept`, {
      method: "POST",
    });
    const payload = (await response.json()) as {
      workspaceId?: string;
      error?: string;
    };
    if (!response.ok || !payload.workspaceId) {
      setError(payload.error ?? "The invite could not be accepted.");
      setBusy(false);
      return;
    }
    router.push(`/workspaces/${payload.workspaceId}`);
    router.refresh();
  }

  return (
    <>
      <button
        className="primary-button"
        type="button"
        disabled={busy}
        onClick={() => void accept()}
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
