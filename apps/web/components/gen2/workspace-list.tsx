"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { LoaderCircle, Trash2 } from "lucide-react";
import type { Gen2Workspace } from "@codev/contracts";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/platform/utils";

const STATUS_LABEL: Record<Gen2Workspace["status"], string> = {
  pending: "Idle",
  provisioning: "Starting",
  ready: "Ready",
  failed: "Failed",
  stopped: "Idle",
  deleting: "Deleting",
};

const STATUS_DOT: Record<Gen2Workspace["status"], string> = {
  pending: "bg-muted-foreground/50",
  provisioning: "bg-amber-400 animate-pulse motion-reduce:animate-none",
  ready: "bg-emerald-500",
  failed: "bg-destructive",
  stopped: "bg-muted-foreground/50",
  deleting: "bg-destructive",
};

export function Gen2WorkspaceList({
  workspaces: initialWorkspaces,
}: {
  workspaces: Gen2Workspace[];
}) {
  const router = useRouter();
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

  if (workspaces.length === 0) {
    return <p className="text-sm text-muted-foreground">No workspaces yet.</p>;
  }

  return (
    <ul className="grid gap-3">
      {workspaces.map((workspace) => {
        const isDeleting = deletingId === workspace.id;
        const deletionPending = workspace.status === "deleting";
        const error =
          actionError?.workspaceId === workspace.id
            ? actionError.message
            : null;
        const cardContent = (
          <>
            <strong className="min-w-0 flex-1 truncate text-[15px] font-semibold">
              {workspace.name}
            </strong>
            {workspace.repository ? (
              <span className="hidden max-w-[16rem] truncate rounded-full border border-border px-2.5 py-0.5 font-mono text-xs text-muted-foreground sm:inline">
                {workspace.repository.fullName}
              </span>
            ) : null}
            <span className="inline-flex shrink-0 items-center gap-2 text-sm text-muted-foreground">
              <span
                aria-hidden="true"
                className={cn(
                  "size-2 rounded-full",
                  STATUS_DOT[workspace.status],
                )}
              />
              {STATUS_LABEL[workspace.status]}
            </span>
          </>
        );

        return (
          <li key={workspace.id}>
            <div className="flex items-stretch gap-2">
              {deletionPending ? (
                <Card className="flex min-h-14 flex-1 items-center gap-3 px-4 py-3 opacity-70">
                  {cardContent}
                </Card>
              ) : (
                <Link
                  className="flex min-w-0 flex-1 rounded-xl outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  href={`/gen2/${workspace.id}`}
                >
                  <Card className="flex min-h-14 w-full items-center gap-3 px-4 py-3 transition-colors hover:border-input hover:bg-secondary">
                    {cardContent}
                  </Card>
                </Link>
              )}
              {workspace.role === "owner" ? (
                <Button
                  aria-label={
                    isDeleting
                      ? `Deleting ${workspace.name}`
                      : deletionPending
                        ? `Retry deletion of ${workspace.name}`
                        : `Delete ${workspace.name}`
                  }
                  className="h-auto min-h-14 w-11 self-stretch hover:text-destructive"
                  disabled={deletingId !== null}
                  onClick={() => void deleteWorkspace(workspace)}
                  title={
                    deletionPending ? "Retry deletion" : "Delete workspace"
                  }
                  type="button"
                  variant="secondary"
                >
                  {isDeleting ? (
                    <LoaderCircle
                      aria-hidden="true"
                      className="animate-spin motion-reduce:animate-none"
                      size={18}
                    />
                  ) : (
                    <Trash2 aria-hidden="true" size={18} />
                  )}
                </Button>
              ) : null}
            </div>
            {deletionPending && !error ? (
              <p
                className="mt-1.5 text-sm text-destructive"
                role={workspace.lastError ? "alert" : "status"}
              >
                {workspace.lastError
                  ? "Deletion did not finish. Retry deletion to continue."
                  : "Workspace deletion is in progress."}
              </p>
            ) : null}
            {error ? (
              <p className="mt-1.5 text-sm text-destructive" role="alert">
                {error}
              </p>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
