"use client";

import { useEffect, useState } from "react";

import {
  ShareDialog,
  type WorkspaceShareMember,
} from "@/components/share-dialog";

type ShareToast = {
  kind: "success" | "error";
  message: string;
};

export function WorkspaceShareButton({
  workspaceId,
  canShare,
  isOwner,
  workspaceName,
  members,
}: {
  workspaceId: string;
  canShare: boolean;
  isOwner: boolean;
  workspaceName?: string;
  members?: WorkspaceShareMember[];
}) {
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<ShareToast | null>(null);

  useEffect(() => {
    if (!toast) return;
    const duration = toast.kind === "success" ? 3_600 : 4_200;
    const timer = window.setTimeout(() => setToast(null), duration);
    return () => window.clearTimeout(timer);
  }, [toast]);

  if (!canShare) return null;

  if (workspaceName && members) {
    return (
      <ShareDialog
        workspaceId={workspaceId}
        workspaceName={workspaceName}
        members={members}
        canShare={canShare}
        isOwner={isOwner}
      />
    );
  }

  async function share() {
    setBusy(true);
    setToast(null);
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/invites`, {
        method: "POST",
      });
      const payload = (await response.json()) as {
        inviteUrl?: string;
        error?: string;
      };
      if (!response.ok || !payload.inviteUrl) {
        setToast({
          kind: "error",
          message: payload.error ?? "Couldn't create an invite link.",
        });
        return;
      }

      try {
        await navigator.clipboard.writeText(payload.inviteUrl);
        setToast({
          kind: "success",
          message: "Invite link copied — share it to collaborate.",
        });
      } catch {
        setToast({
          kind: "error",
          message: "Invite ready, but clipboard copy failed. Try again.",
        });
      }
    } catch {
      setToast({
        kind: "error",
        message: "Couldn't create an invite link.",
      });
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
        aria-busy={busy}
      >
        {busy ? "Sharing…" : "Share"}
      </button>
      {toast ? (
        <div
          className={`workspace-share-toast workspace-share-toast-${toast.kind}`}
          role={toast.kind === "error" ? "alert" : "status"}
          aria-live={toast.kind === "error" ? "assertive" : "polite"}
        >
          {toast.message}
        </div>
      ) : null}
    </div>
  );
}
