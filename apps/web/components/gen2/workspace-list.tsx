"use client";

import { useState } from "react";
import Link from "next/link";
import { LoaderCircle, Trash2 } from "lucide-react";
import type { Gen2Workspace } from "@codev/contracts";

const STATUS_LABEL: Record<Gen2Workspace["status"], string> = {
  pending: "Idle",
  provisioning: "Starting",
  ready: "Ready",
  failed: "Failed",
  stopped: "Idle",
};

export function Gen2WorkspaceList({
  workspaces: initialWorkspaces,
}: {
  workspaces: Gen2Workspace[];
}) {
  const [workspaces, setWorkspaces] = useState(initialWorkspaces);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<{
    workspaceId: string;
    message: string;
  } | null>(null);

  async function deleteWorkspace(workspace: Gen2Workspace) {
    const confirmed = window.confirm(
      `Delete “${workspace.name}”? This permanently deletes the workspace, its saved files, and all chat history for everyone with access.`,
    );
    if (!confirmed) return;

    setDeletingId(workspace.id);
    setActionError(null);
    try {
      const response = await fetch(`/api/gen2/workspaces/${workspace.id}`, {
        method: "DELETE",
      });
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;

      if (!response.ok) {
        setActionError({
          workspaceId: workspace.id,
          message: payload?.error ?? "Couldn't delete this workspace.",
        });
        return;
      }

      setWorkspaces((current) =>
        current.filter((item) => item.id !== workspace.id),
      );
    } catch {
      setActionError({
        workspaceId: workspace.id,
        message: "Couldn't reach the server. Try again.",
      });
    } finally {
      setDeletingId(null);
    }
  }

  if (workspaces.length === 0) {
    return <p className="gen2-empty">No workspaces yet.</p>;
  }

  return (
    <ul className="gen2-list">
      {workspaces.map((workspace) => {
        const isDeleting = deletingId === workspace.id;
        const error =
          actionError?.workspaceId === workspace.id
            ? actionError.message
            : null;

        return (
          <li key={workspace.id}>
            <div className="gen2-card-row">
              <Link className="gen2-card" href={`/gen2/${workspace.id}`}>
                <strong>{workspace.name}</strong>
                {workspace.repository ? (
                  <span className="gen2-card-repo">
                    {workspace.repository.fullName}
                  </span>
                ) : null}
                <span className={`gen2-status gen2-status-${workspace.status}`}>
                  <span className="gen2-status-dot" aria-hidden="true" />
                  {STATUS_LABEL[workspace.status]}
                </span>
              </Link>
              {workspace.role === "owner" ? (
                <button
                  type="button"
                  className="gen2-delete-button"
                  aria-label={
                    isDeleting
                      ? `Deleting ${workspace.name}`
                      : `Delete ${workspace.name}`
                  }
                  title="Delete workspace"
                  disabled={deletingId !== null}
                  onClick={() => void deleteWorkspace(workspace)}
                >
                  {isDeleting ? (
                    <LoaderCircle
                      className="gen2-delete-spinner"
                      aria-hidden="true"
                      size={18}
                    />
                  ) : (
                    <Trash2 aria-hidden="true" size={18} />
                  )}
                </button>
              ) : null}
            </div>
            {error ? (
              <p className="gen2-action-error" role="alert">
                {error}
              </p>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
