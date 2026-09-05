"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, History, RotateCcw } from "lucide-react";

import {
  OrcaCard,
  OrcaPageHeader,
  OrcaPageShell,
} from "@/components/settings/orca-style";
import { Input } from "@/components/ui/input";
import type { ActivityAuditSnapshot } from "@/lib/activity-audit-server";
import type { ActivityEvent } from "@/lib/activity-audit-view";

type FileHistoryEntry = {
  revision: string;
  author: string;
  date: string;
  message: string;
};

async function readJsonError(response: Response, fallback: string) {
  try {
    const data = (await response.json()) as { error?: string };
    return data.error || fallback;
  } catch {
    return fallback;
  }
}

export function WorkspaceActivityFeed({
  workspaceId,
  repository,
  canRestoreFiles,
  canRestoreWorkspace,
  initialSnapshot,
}: {
  workspaceId: string;
  repository: string | null;
  canRestoreFiles: boolean;
  canRestoreWorkspace: boolean;
  initialSnapshot: ActivityAuditSnapshot;
}) {
  const [events, setEvents] = useState<ActivityEvent[]>(
    initialSnapshot.events,
  );
  const [cursor, setCursor] = useState<number | null>(
    initialSnapshot.nextCursor,
  );
  const [loadingMore, setLoadingMore] = useState(false);
  const [restoringEventId, setRestoringEventId] = useState<string | null>(
    null,
  );
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [path, setPath] = useState("");
  const [history, setHistory] = useState<FileHistoryEntry[] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [restoringRevision, setRestoringRevision] = useState<string | null>(
    null,
  );

  async function loadMore() {
    if (cursor == null || loadingMore) return;
    setLoadingMore(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/workspaces/${workspaceId}/events?before=${cursor}&limit=30`,
      );
      if (!response.ok) {
        throw new Error(
          await readJsonError(response, "Could not load more activity."),
        );
      }
      const data = (await response.json()) as ActivityAuditSnapshot;
      setEvents((previous) => [...previous, ...data.events]);
      setCursor(data.nextCursor);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Could not load more activity.",
      );
    } finally {
      setLoadingMore(false);
    }
  }

  async function revertMerge(event: ActivityEvent) {
    if (!event.restoreRevision) return;
    if (
      !window.confirm(
        "Revert this merge? The workspace resets to the state right before it. The current state is saved to a backup branch first, so nothing is lost.",
      )
    ) {
      return;
    }
    setRestoringEventId(event.id);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(
        `/api/workspaces/${workspaceId}/restore/workspace`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ revision: event.restoreRevision }),
        },
      );
      if (!response.ok) {
        throw new Error(
          await readJsonError(response, "Could not revert this merge."),
        );
      }
      const data = (await response.json()) as { backupBranch: string };
      setNotice(`Workspace restored. Backup saved as ${data.backupBranch}.`);
    } catch (revertError) {
      setError(
        revertError instanceof Error
          ? revertError.message
          : "Could not revert this merge.",
      );
    } finally {
      setRestoringEventId(null);
    }
  }

  async function viewFileHistory() {
    const target = path.trim();
    if (!target) return;
    setHistoryLoading(true);
    setHistory(null);
    setError(null);
    try {
      const response = await fetch(
        `/api/workspaces/${workspaceId}/file-history?path=${encodeURIComponent(target)}`,
      );
      if (!response.ok) {
        throw new Error(
          await readJsonError(response, "Could not load file history."),
        );
      }
      const data = (await response.json()) as { entries: FileHistoryEntry[] };
      setHistory(data.entries);
    } catch (historyError) {
      setError(
        historyError instanceof Error
          ? historyError.message
          : "Could not load file history.",
      );
    } finally {
      setHistoryLoading(false);
    }
  }

  async function restoreFile(revision: string) {
    const target = path.trim();
    if (
      !window.confirm(
        `Restore ${target} to this version? It lands in the working tree, uncommitted, for you to review in Source Control.`,
      )
    ) {
      return;
    }
    setRestoringRevision(revision);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(
        `/api/workspaces/${workspaceId}/restore/file`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: target, revision }),
        },
      );
      if (!response.ok) {
        throw new Error(
          await readJsonError(response, "Could not restore this file."),
        );
      }
      setNotice(`${target} restored to this version — review it in Source Control.`);
    } catch (restoreError) {
      setError(
        restoreError instanceof Error
          ? restoreError.message
          : "Could not restore this file.",
      );
    } finally {
      setRestoringRevision(null);
    }
  }

  return (
    <OrcaPageShell>
      <Link
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        href={`/workspaces/${workspaceId}`}
      >
        <ArrowLeft aria-hidden size={14} />
        Back to workspace
      </Link>
      <OrcaPageHeader
        description={
          repository
            ? `A durable history of what happened in ${repository}, with restore for tracked changes.`
            : "A durable history of what happened in this workspace, with restore for tracked changes."
        }
        title="Activity"
      />

      {error ? (
        <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-600">
          {notice}
        </p>
      ) : null}

      {canRestoreFiles ? (
        <OrcaCard className="space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-foreground">
              Restore a file
            </h3>
            <p className="text-sm text-muted-foreground">
              Look up a file&rsquo;s history and bring back an earlier
              version.
            </p>
          </div>
          <div className="flex gap-2">
            <Input
              onChange={(event) => setPath(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void viewFileHistory();
              }}
              placeholder="path/to/file.ts"
              value={path}
            />
            <button
              className="shrink-0 rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
              disabled={!path.trim() || historyLoading}
              onClick={() => void viewFileHistory()}
              type="button"
            >
              {historyLoading ? "Loading…" : "View history"}
            </button>
          </div>
          {history ? (
            history.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No history found for this path.
              </p>
            ) : (
              <ul className="divide-y divide-border/60">
                {history.map((entry) => (
                  <li
                    className="flex items-center justify-between gap-3 py-2.5"
                    key={entry.revision}
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm text-foreground">
                        {entry.message}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {entry.author} ·{" "}
                        {new Date(entry.date).toLocaleString()} ·{" "}
                        {entry.revision.slice(0, 7)}
                      </p>
                    </div>
                    <button
                      className="shrink-0 rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50"
                      disabled={restoringRevision === entry.revision}
                      onClick={() => void restoreFile(entry.revision)}
                      type="button"
                    >
                      {restoringRevision === entry.revision
                        ? "Restoring…"
                        : "Restore this version"}
                    </button>
                  </li>
                ))}
              </ul>
            )
          ) : null}
        </OrcaCard>
      ) : null}

      <OrcaCard className="space-y-0 p-0">
        <div className="px-7 pt-6 pb-1">
          <h3 className="text-sm font-semibold text-foreground">
            Recent activity
          </h3>
        </div>
        {events.length === 0 ? (
          <p className="px-7 pb-6 text-sm text-muted-foreground">
            Nothing has happened here yet.
          </p>
        ) : (
          <ul className="divide-y divide-border/60 px-7">
            {events.map((event) => (
              <li
                className="flex items-center justify-between gap-3 py-3"
                key={event.id}
              >
                <div className="min-w-0">
                  <p className="truncate text-sm text-foreground">
                    {event.summary}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(event.createdAt).toLocaleString()}
                  </p>
                </div>
                {canRestoreWorkspace && event.restoreRevision ? (
                  <button
                    className="flex shrink-0 items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50"
                    disabled={restoringEventId === event.id}
                    onClick={() => void revertMerge(event)}
                    type="button"
                  >
                    <RotateCcw aria-hidden size={12} />
                    {restoringEventId === event.id
                      ? "Reverting…"
                      : "Revert this merge"}
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        <div className="px-7 pt-3 pb-6">
          {cursor != null ? (
            <button
              className="w-full rounded-lg border border-border py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
              disabled={loadingMore}
              onClick={() => void loadMore()}
              type="button"
            >
              {loadingMore ? "Loading…" : "Load more"}
            </button>
          ) : (
            <p className="flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
              <History aria-hidden size={12} />
              That&rsquo;s the beginning of this workspace&rsquo;s history.
            </p>
          )}
        </div>
      </OrcaCard>
    </OrcaPageShell>
  );
}
