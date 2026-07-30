"use client";

import { useEffect, useState } from "react";

export function WorkspaceShareButton({
  workspaceId,
  isOwner,
}: {
  workspaceId: string;
  isOwner: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2_800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  if (!isOwner) return null;

  async function share() {
    setBusy(true);
    setToast("");
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/invites`, {
        method: "POST",
      });
      const payload = (await response.json()) as {
        inviteUrl?: string;
        error?: string;
      };
      if (!response.ok || !payload.inviteUrl) {
        setToast(payload.error ?? "Invite could not be created.");
        return;
      }
      await navigator.clipboard.writeText(payload.inviteUrl);
      setToast("Invite link copied.");
    } catch {
      setToast("Invite could not be created.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="workspace-share">
      <button
        className="workspace-share-button"
        type="button"
        disabled={busy}
        onClick={() => void share()}
      >
        {busy ? "Sharing…" : "Share"}
      </button>
      {toast ? (
        <div className="workspace-share-toast" role="status">
          {toast}
        </div>
      ) : null}
    </div>
  );
}
