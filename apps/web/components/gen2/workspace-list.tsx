"use client";

import { useMemo, useState } from "react";
import { Plus, SearchX, Sparkles } from "lucide-react";
import type { Gen2Workspace } from "@codev/contracts";

import { ConfirmDialog } from "@/components/settings/confirm-dialog";
import { Button } from "@/components/ui/button";
import { WorkspaceCard } from "@/components/gen2/workspace-card";

export type WorkspaceFilter = "all" | "owned" | "shared";

function matches(
  workspace: Gen2Workspace,
  filter: WorkspaceFilter,
  query: string,
) {
  if (filter === "owned" && workspace.role !== "owner") return false;
  if (filter === "shared" && workspace.role === "owner") return false;
  if (!query) return true;
  return [workspace.name, workspace.repository?.fullName ?? ""].some((text) =>
    text.toLowerCase().includes(query),
  );
}

function EmptyState({
  filtered,
  query,
  filter,
  canCreate,
  onCreate,
  onClear,
}: {
  filtered: boolean;
  query: string;
  filter: WorkspaceFilter;
  canCreate: boolean;
  onCreate?: (() => void) | undefined;
  onClear?: (() => void) | undefined;
}) {
  if (!filtered) {
    return (
      <div className="gen2-empty-state">
        <span className="gen2-empty-icon" aria-hidden="true">
          <Sparkles />
        </span>
        <h2>Create your first workspace</h2>
        <p>
          A cloud machine you share with teammates and AI agents. Start blank or
          import a GitHub repository.
        </p>
        {canCreate && onCreate ? (
          <Button onClick={onCreate}>
            <Plus aria-hidden="true" /> New workspace
          </Button>
        ) : null}
      </div>
    );
  }
  const title = query
    ? `No workspaces match “${query}”`
    : filter === "shared"
      ? "Nothing shared with you yet"
      : "You don’t own any workspaces yet";
  const description = query
    ? "Try a different name or repository."
    : filter === "shared"
      ? "When a teammate invites you to a workspace, it appears here."
      : "Workspaces you create appear here.";
  return (
    <div className="gen2-empty-state is-compact">
      <span className="gen2-empty-icon" aria-hidden="true">
        <SearchX />
      </span>
      <h2>{title}</h2>
      <p>{description}</p>
      {onClear ? (
        <Button variant="outline" size="sm" onClick={onClear}>
          Show all workspaces
        </Button>
      ) : null}
    </div>
  );
}

/**
 * The workspace cards on the home page, newest activity first. Deleting asks
 * for a press-and-hold confirmation; the parent owns the workspace list and
 * reflects the result (removed, or "Deleting" while the VM is torn down).
 */
export function Gen2WorkspaceList({
  workspaces,
  viewMode = "list",
  searchQuery = "",
  filter = "all",
  canCreate = false,
  onCreateWorkspace,
  onClearFilters,
  onDeleted,
}: {
  workspaces: Gen2Workspace[];
  viewMode?: "grid" | "list";
  searchQuery?: string;
  filter?: WorkspaceFilter;
  canCreate?: boolean;
  onCreateWorkspace?: () => void;
  onClearFilters?: () => void;
  onDeleted?: (workspace: Gen2Workspace, accepted: boolean) => void;
}) {
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<Gen2Workspace | null>(null);
  const [actionError, setActionError] = useState<{
    workspaceId: string;
    message: string;
  } | null>(null);
  const query = searchQuery.trim().toLowerCase();

  const visible = useMemo(
    () =>
      workspaces
        .filter((workspace) => matches(workspace, filter, query))
        .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)),
    [workspaces, filter, query],
  );

  async function deleteWorkspace(workspace: Gen2Workspace) {
    setConfirming(null);
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
      onDeleted?.(workspace, response.status === 202);
    } catch {
      setActionError({
        workspaceId: workspace.id,
        message: "Couldn't reach the server. Try again.",
      });
    } finally {
      setDeletingId(null);
    }
  }

  const showCreateCard =
    canCreate && viewMode === "grid" && filter !== "shared" && !query;
  if (visible.length === 0 && (workspaces.length === 0 || !showCreateCard)) {
    return (
      <EmptyState
        filtered={workspaces.length > 0}
        query={searchQuery.trim()}
        filter={filter}
        canCreate={canCreate}
        onCreate={onCreateWorkspace}
        onClear={onClearFilters}
      />
    );
  }

  return (
    <div className={viewMode === "grid" ? "gen2-grid" : "gen2-rows"}>
      {confirming ? (
        <ConfirmDialog
          title={`Delete “${confirming.name}”?`}
          confirmLabel="Hold to delete workspace"
          holdToConfirm
          onConfirm={() => void deleteWorkspace(confirming)}
          onCancel={() => setConfirming(null)}
        >
          This permanently deletes the workspace, its saved files, and all chat
          history for everyone with access.
        </ConfirmDialog>
      ) : null}
      {showCreateCard ? (
        <button
          type="button"
          className="gen2-new-card"
          onClick={onCreateWorkspace}
        >
          <span className="gen2-new-icon" aria-hidden="true">
            <Plus />
          </span>
          <strong className="gen2-new-title">New workspace</strong>
          <span className="gen2-new-desc">
            Start blank or from a GitHub repository.
          </span>
        </button>
      ) : null}
      {visible.map((workspace) => (
        <WorkspaceCard
          key={workspace.id}
          workspace={workspace}
          variant={viewMode}
          deleting={deletingId === workspace.id}
          deleteLocked={deletingId !== null}
          error={
            actionError?.workspaceId === workspace.id
              ? actionError.message
              : null
          }
          onDelete={() => setConfirming(workspace)}
        />
      ))}
    </div>
  );
}
