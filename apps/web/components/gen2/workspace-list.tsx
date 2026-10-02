"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { LoaderCircle, Plus, Trash2 } from "lucide-react";
import type { Gen2Workspace } from "@codev/contracts";

import { GithubMark } from "@/components/settings/github-mark";

const STATUS_LABEL: Record<Gen2Workspace["status"], string> = {
  pending: "Idle",
  provisioning: "Starting",
  ready: "Ready",
  failed: "Failed",
  stopped: "Idle",
  deleting: "Deleting",
};

export function Gen2WorkspaceList({
  workspaces: initialWorkspaces,
  viewMode = "list",
  searchQuery = "",
  filter = "all",
  showCreateCard = false,
  onCreateWorkspace,
  onWorkspacesChange,
}: {
  workspaces: Gen2Workspace[];
  viewMode?: "grid" | "list";
  searchQuery?: string;
  filter?: "all" | "owned" | "shared";
  showCreateCard?: boolean;
  onCreateWorkspace?: () => void;
  onWorkspacesChange?: (workspaces: Gen2Workspace[]) => void;
}) {
  const router = useRouter();
  const [workspaces, setWorkspaces] = useState(initialWorkspaces);
  const [workspaceSource, setWorkspaceSource] = useState(initialWorkspaces);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<{
    workspaceId: string;
    message: string;
  } | null>(null);
  if (workspaceSource !== initialWorkspaces) {
    setWorkspaceSource(initialWorkspaces);
    setWorkspaces(initialWorkspaces);
  }

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

      const updated = workspaces.filter((item) => item.id !== workspace.id);
      setWorkspaces(updated);
      onWorkspacesChange?.(updated);
      router.refresh();
    } catch {
      setActionError({
        workspaceId: workspace.id,
        message: "Couldn't reach the server. Try again.",
      });
    } finally {
      setDeletingId(null);
    }
  }

  const filteredWorkspaces = useMemo(() => {
    return workspaces.filter((workspace) => {
      if (filter === "owned" && workspace.role !== "owner") return false;
      if (filter === "shared" && workspace.role === "owner") return false;
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        const matchName = workspace.name.toLowerCase().includes(q);
        const matchRepo = workspace.repository?.fullName
          .toLowerCase()
          .includes(q);
        if (!matchName && !matchRepo) return false;
      }
      return true;
    });
  }, [workspaces, filter, searchQuery]);

  if (workspaces.length === 0 && !showCreateCard) {
    return <p className="gen2-empty">No workspaces yet.</p>;
  }

  if (viewMode === "grid") {
    return (
      <div className="gen2-grid">
        {showCreateCard ? (
          <button
            type="button"
            className="gen2-new-card"
            onClick={onCreateWorkspace}
            aria-label="New workspace"
          >
            <span className="gen2-new-icon" aria-hidden="true">
              <Plus size={20} strokeWidth={2.2} />
            </span>
            <strong className="gen2-new-title">New workspace</strong>
            <span className="gen2-new-desc">
              Start a current workspace or a shareable Firecracker instance.
            </span>
          </button>
        ) : null}

        {filteredWorkspaces.map((workspace) => {
          const isDeleting = deletingId === workspace.id;
          const deletionPending = workspace.status === "deleting";
          const error =
            actionError?.workspaceId === workspace.id
              ? actionError.message
              : null;

          const gridContent = (
            <>
              <div className="gen2-grid-card-top">
                <strong className="gen2-grid-card-name">
                  {workspace.name}
                </strong>
                <span className="gen2-role-badge">
                  {workspace.role === "owner" ? "Owner" : "Shared"}
                </span>
              </div>
              <div className="gen2-grid-card-mid">
                {workspace.repository ? (
                  <span className="gen2-card-repo">
                    <GithubMark className="gen2-repo-mark" />
                    <span>{workspace.repository.fullName}</span>
                  </span>
                ) : (
                  <span className="gen2-card-repo">Blank machine</span>
                )}
              </div>
              <div className="gen2-grid-card-bottom">
                <span className={`gen2-status gen2-status-${workspace.status}`}>
                  <span className="gen2-status-dot" aria-hidden="true" />
                  {STATUS_LABEL[workspace.status]}
                </span>
              </div>
            </>
          );

          return (
            <div key={workspace.id} className="gen2-grid-item">
              {deletionPending ? (
                <div className="gen2-grid-card gen2-card-pending">
                  {gridContent}
                </div>
              ) : (
                <Link className="gen2-grid-card" href={`/gen2/${workspace.id}`}>
                  {gridContent}
                </Link>
              )}
              {workspace.role === "owner" ? (
                <button
                  type="button"
                  className="gen2-grid-delete-button"
                  aria-label={
                    isDeleting
                      ? `Deleting ${workspace.name}`
                      : deletionPending
                        ? `Retry deletion of ${workspace.name}`
                        : `Delete ${workspace.name}`
                  }
                  title={
                    deletionPending ? "Retry deletion" : "Delete workspace"
                  }
                  disabled={deletingId !== null}
                  onClick={(e) => {
                    e.stopPropagation();
                    void deleteWorkspace(workspace);
                  }}
                >
                  {isDeleting ? (
                    <LoaderCircle
                      className="gen2-delete-spinner"
                      aria-hidden="true"
                      size={16}
                    />
                  ) : (
                    <Trash2 aria-hidden="true" size={16} />
                  )}
                </button>
              ) : null}
              {deletionPending && !error ? (
                <p
                  className="gen2-action-error"
                  role={workspace.lastError ? "alert" : "status"}
                >
                  {workspace.lastError
                    ? "Deletion did not finish. Retry deletion to continue."
                    : "Workspace deletion is in progress."}
                </p>
              ) : null}
              {error ? (
                <p className="gen2-action-error" role="alert">
                  {error}
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <ul className="gen2-list">
      {filteredWorkspaces.map((workspace) => {
        const isDeleting = deletingId === workspace.id;
        const deletionPending = workspace.status === "deleting";
        const error =
          actionError?.workspaceId === workspace.id
            ? actionError.message
            : null;
        const cardContent = (
          <>
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
          </>
        );

        return (
          <li key={workspace.id}>
            <div className="gen2-card-row">
              {deletionPending ? (
                <div className="gen2-card gen2-card-pending">{cardContent}</div>
              ) : (
                <Link className="gen2-card" href={`/gen2/${workspace.id}`}>
                  {cardContent}
                </Link>
              )}
              {workspace.role === "owner" ? (
                <button
                  type="button"
                  className="gen2-delete-button"
                  aria-label={
                    isDeleting
                      ? `Deleting ${workspace.name}`
                      : deletionPending
                        ? `Retry deletion of ${workspace.name}`
                        : `Delete ${workspace.name}`
                  }
                  title={
                    deletionPending ? "Retry deletion" : "Delete workspace"
                  }
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
            {deletionPending && !error ? (
              <p
                className="gen2-action-error"
                role={workspace.lastError ? "alert" : "status"}
              >
                {workspace.lastError
                  ? "Deletion did not finish. Retry deletion to continue."
                  : "Workspace deletion is in progress."}
              </p>
            ) : null}
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
