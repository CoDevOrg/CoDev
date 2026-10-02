"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Cloud,
  LoaderCircle,
  MoreHorizontal,
  Search,
  Trash2,
} from "lucide-react";
import type { Gen2Workspace } from "@codev/contracts";

import { ConfirmDialog } from "@/components/settings/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button, LinkButton } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/platform/utils";

// "Not started" and "Stopped" are different states: the first has never had a
// machine, the second had one and it was shut down.
const STATUS_LABEL: Record<Gen2Workspace["status"], string> = {
  pending: "Not started",
  provisioning: "Starting",
  ready: "Ready",
  failed: "Failed",
  stopped: "Stopped",
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

type SortKey = "updated" | "name";

/** Search and sort earn their space only once there is a list to search. */
const CONTROLS_THRESHOLD = 4;

const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 60 * 60],
  ["month", 30 * 24 * 60 * 60],
  ["day", 24 * 60 * 60],
  ["hour", 60 * 60],
  ["minute", 60],
];

function formatUpdated(iso: string): string {
  const seconds = (new Date(iso).getTime() - Date.now()) / 1000;
  if (Number.isNaN(seconds)) return "";
  const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  for (const [unit, size] of RELATIVE_UNITS) {
    if (Math.abs(seconds) >= size) {
      return formatter.format(Math.round(seconds / size), unit);
    }
  }
  return "just now";
}

/**
 * The per-workspace actions menu. Delete lives here, one step away from the
 * card, so it is not a misclick beside the link that opens the workspace.
 */
function WorkspaceMenu({
  workspace,
  busy,
  disabled,
  onDelete,
}: {
  workspace: Gen2Workspace;
  busy: boolean;
  disabled: boolean;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const retry = workspace.status === "deleting";

  useEffect(() => {
    if (!open) return;
    itemRef.current?.focus();
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className="relative" ref={rootRef}>
      <Button
        aria-controls={open ? menuId : undefined}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`Actions for ${workspace.name}`}
        className="size-9"
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        ref={triggerRef}
        size="icon-sm"
        type="button"
        variant="secondary"
      >
        {busy ? (
          <LoaderCircle
            aria-hidden="true"
            className="animate-spin motion-reduce:animate-none"
            size={16}
          />
        ) : (
          <MoreHorizontal aria-hidden="true" size={16} />
        )}
      </Button>
      {open ? (
        <div
          aria-label={`Actions for ${workspace.name}`}
          className="absolute top-full right-0 z-20 mt-1 min-w-44 rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg"
          id={menuId}
          role="menu"
        >
          <button
            className="flex w-full cursor-pointer items-center gap-2 rounded-md border-0 bg-transparent px-3 py-2 text-left text-sm text-destructive transition-colors outline-none hover:bg-destructive/10 focus-visible:bg-destructive/10"
            onClick={() => {
              setOpen(false);
              onDelete();
            }}
            ref={itemRef}
            role="menuitem"
            type="button"
          >
            <Trash2 aria-hidden="true" size={15} />
            {retry ? "Retry deletion" : "Delete workspace"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function Gen2WorkspaceList({
  workspaces: initialWorkspaces,
}: {
  workspaces: Gen2Workspace[];
}) {
  const router = useRouter();
  const [workspaces, setWorkspaces] = useState(initialWorkspaces);
  const [confirming, setConfirming] = useState<Gen2Workspace | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("updated");
  const [actionError, setActionError] = useState<{
    workspaceId: string;
    message: string;
  } | null>(null);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matches = needle
      ? workspaces.filter(
          (workspace) =>
            workspace.name.toLowerCase().includes(needle) ||
            (workspace.repository?.fullName.toLowerCase().includes(needle) ??
              false),
        )
      : workspaces;
    return [...matches].sort((a, b) =>
      sort === "name"
        ? a.name.localeCompare(b.name)
        : b.updatedAt.localeCompare(a.updatedAt),
    );
  }, [workspaces, query, sort]);

  async function deleteWorkspace(workspace: Gen2Workspace) {
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
    return (
      <Card className="flex flex-col items-center gap-3 border-dashed px-6 py-12 text-center">
        <span className="flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Cloud aria-hidden="true" size={20} />
        </span>
        <div className="space-y-1">
          <h2 className="m-0 text-base font-semibold">No workspaces yet</h2>
          <p className="max-w-sm text-sm text-muted-foreground">
            A workspace is a cloud computer with your code and an AI agent on
            it. Create one above, then send its link to invite teammates.
          </p>
        </div>
        <LinkButton href="#new-workspace" size="sm">
          Create your first workspace
        </LinkButton>
      </Card>
    );
  }

  return (
    <section aria-label="Your workspaces" className="space-y-3">
      {workspaces.length >= CONTROLS_THRESHOLD ? (
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-[14rem] flex-1">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground"
              size={14}
            />
            <Input
              aria-label="Search workspaces"
              autoComplete="off"
              className="pl-9"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search workspaces"
              type="search"
              value={query}
            />
          </div>
          <select
            aria-label="Sort workspaces"
            className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            onChange={(event) => setSort(event.target.value as SortKey)}
            value={sort}
          >
            <option value="updated">Recently updated</option>
            <option value="name">Name</option>
          </select>
        </div>
      ) : null}

      {visible.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No workspaces match &ldquo;{query.trim()}&rdquo;.
        </p>
      ) : (
        <ul className="grid gap-3">
          {visible.map((workspace) => {
            const isDeleting = deletingId === workspace.id;
            const deletionPending = workspace.status === "deleting";
            const error =
              actionError?.workspaceId === workspace.id
                ? actionError.message
                : null;
            const isOwner = workspace.role === "owner";
            const cardContent = (
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <strong className="truncate text-[15px] font-semibold">
                  {workspace.name}
                </strong>
                <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <Badge variant={isOwner ? "muted" : "outline"}>
                    {isOwner ? "Owned by you" : "Shared with you"}
                  </Badge>
                  {workspace.repository ? (
                    <span className="max-w-[16rem] truncate font-mono">
                      {workspace.repository.fullName}
                    </span>
                  ) : null}
                  <time
                    dateTime={workspace.updatedAt}
                    suppressHydrationWarning
                    title={new Date(workspace.updatedAt).toLocaleString()}
                  >
                    Updated {formatUpdated(workspace.updatedAt)}
                  </time>
                </span>
              </div>
            );
            const status = (
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
            );

            return (
              <li key={workspace.id}>
                <div className="flex items-center gap-2">
                  {deletionPending ? (
                    <Card className="flex min-h-16 flex-1 items-center gap-3 px-4 py-3 opacity-70">
                      {cardContent}
                      {status}
                    </Card>
                  ) : (
                    <Link
                      className="flex min-w-0 flex-1 rounded-xl outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                      href={`/gen2/${workspace.id}`}
                    >
                      <Card className="flex min-h-16 w-full items-center gap-3 px-4 py-3 transition-colors hover:border-input hover:bg-secondary">
                        {cardContent}
                        {status}
                      </Card>
                    </Link>
                  )}
                  {isOwner ? (
                    <WorkspaceMenu
                      busy={isDeleting}
                      disabled={deletingId !== null}
                      onDelete={() => setConfirming(workspace)}
                      workspace={workspace}
                    />
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
      )}

      {confirming ? (
        <ConfirmDialog
          busy={deletingId !== null}
          confirmLabel="Delete workspace"
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            const target = confirming;
            setConfirming(null);
            void deleteWorkspace(target);
          }}
          title={`Delete “${confirming.name}”?`}
        >
          <p>This permanently deletes, for everyone with access:</p>
          <ul className="mt-2 list-disc space-y-0.5 pl-5">
            <li>the workspace and its machine</li>
            <li>all saved files</li>
            <li>every chat and its history</li>
          </ul>
          <p className="mt-2">This can&apos;t be undone.</p>
        </ConfirmDialog>
      ) : null}
    </section>
  );
}
