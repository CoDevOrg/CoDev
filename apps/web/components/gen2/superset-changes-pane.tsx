"use client";

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { Columns2, GitCompareArrows, RefreshCw, Rows2 } from "lucide-react";

import { parseGitStatus } from "@/lib/runtime/ide";
import { gen2StatusLabel } from "@/lib/gen2/file-tree";
import { WorkspaceButton } from "./workspace-button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const ReviewDiffViewer = dynamic(
  () =>
    import("./review-diff-viewer").then((module) => module.ReviewDiffViewer),
  {
    ssr: false,
    loading: () => (
      <p className="gen2-superset-list-state" role="status">
        Loading diff…
      </p>
    ),
  },
);

function changedPaths(status: string) {
  return [...parseGitStatus(status)].map(([path, code]) => ({ path, code }));
}

async function readGit(
  workspaceId: string,
  worktreeId: string,
  operation: "status" | "diff",
) {
  const query = new URLSearchParams({ worktreeId, operation });
  const response = await fetch(
    `/api/gen2/workspaces/${encodeURIComponent(workspaceId)}/git?${query}`,
  );
  const payload = (await response.json().catch(() => ({}))) as {
    output?: string;
    error?: string;
  };
  if (!response.ok) {
    throw new Error(payload.error ?? "Couldn’t read Git.");
  }
  return payload.output ?? "";
}

export function SupersetChangesPane({
  workspaceId,
  worktreeId,
  visible,
  mode,
  onOpenFile,
  overlapFor,
}: {
  workspaceId: string;
  worktreeId: string;
  visible: boolean;
  mode: "changes" | "review";
  onOpenFile?: (path: string) => void;
  /** Who else is changing a path, when another active agent is. */
  overlapFor?: (path: string) => string | undefined;
}) {
  const [status, setStatus] = useState("");
  const [diff, setDiff] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [diffError, setDiffError] = useState("");
  const [layout, setLayout] = useState<"unified" | "split">("unified");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const nextStatus = await readGit(workspaceId, worktreeId, "status");
      setStatus(nextStatus);
      setError("");
      try {
        const nextDiff = await readGit(workspaceId, worktreeId, "diff");
        setDiff(nextDiff);
        setDiffError("");
      } catch (caught) {
        setDiff("");
        setDiffError(
          caught instanceof Error
            ? caught.message
            : "Couldn’t load the working tree diff.",
        );
      }
      setLoaded(true);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Couldn’t reach CoDev. Try refreshing Changes.",
      );
      setLoaded(false);
    } finally {
      setLoading(false);
    }
  }, [workspaceId, worktreeId]);

  useEffect(() => {
    if (!visible) return;
    const timeout = setTimeout(() => {
      void refresh();
    }, 0);
    return () => clearTimeout(timeout);
  }, [visible, refresh]);

  const files = changedPaths(status);
  const untracked = files.filter((file) => file.code === "??");
  const summary = !loaded
    ? loading
      ? "Reading git status…"
      : "Git status unavailable"
    : files.length
      ? `${files.length} changed file${files.length === 1 ? "" : "s"}`
      : "Working tree is clean";

  return (
    <TooltipProvider delayDuration={300}>
      <section
        id={
          mode === "changes"
            ? "superset-panel-changes"
            : "superset-panel-review"
        }
        role="tabpanel"
        aria-labelledby={
          mode === "changes" ? "superset-tab-changes" : "superset-tab-review"
        }
        hidden={!visible}
        className="gen2-superset-tool-panel gen2-ide-panel"
      >
        <header className="gen2-ide-panel-bar">
          <p>{summary}</p>
          <div className="gen2-ide-panel-bar-actions">
            {mode === "review" && diff.trim() ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <WorkspaceButton
                    size="icon"
                    type="button"
                    aria-label={
                      layout === "split" ? "Use unified diff" : "Use split diff"
                    }
                    aria-pressed={layout === "split"}
                    onClick={() =>
                      setLayout((current) =>
                        current === "split" ? "unified" : "split",
                      )
                    }
                  >
                    {layout === "split" ? (
                      <Rows2 aria-hidden="true" />
                    ) : (
                      <Columns2 aria-hidden="true" />
                    )}
                  </WorkspaceButton>
                </TooltipTrigger>
                <TooltipContent className="gen2-workspace-surface">
                  {layout === "split" ? "Unified" : "Split"}
                </TooltipContent>
              </Tooltip>
            ) : null}
            <Tooltip>
              <TooltipTrigger asChild>
                <WorkspaceButton
                  size="icon"
                  type="button"
                  onClick={() => void refresh()}
                  disabled={loading}
                  aria-label={
                    mode === "review" ? "Refresh review" : "Refresh changes"
                  }
                >
                  <RefreshCw aria-hidden="true" />
                </WorkspaceButton>
              </TooltipTrigger>
              <TooltipContent className="gen2-workspace-surface">
                Refresh
              </TooltipContent>
            </Tooltip>
          </div>
        </header>
        {error ? (
          <div
            className="gen2-superset-notice gen2-superset-notice-error"
            role="alert"
          >
            <span>{error}</span>
            <WorkspaceButton
              tone="ghost"
              type="button"
              onClick={() => void refresh()}
            >
              Retry
            </WorkspaceButton>
          </div>
        ) : null}
        {mode === "review" && diffError ? (
          <div
            className="gen2-superset-notice gen2-superset-notice-error"
            role="alert"
          >
            <span>{diffError}</span>
            <WorkspaceButton
              tone="ghost"
              type="button"
              onClick={() => void refresh()}
            >
              Retry
            </WorkspaceButton>
          </div>
        ) : null}
        {mode === "changes" && files.length ? (
          <ul className="gen2-superset-change-list" aria-label="Changed files">
            {files.map((file) => (
              <li key={file.path}>
                <button
                  type="button"
                  className="gen2-superset-change-file"
                  onClick={() => onOpenFile?.(file.path)}
                >
                  <code
                    data-status={file.code}
                    title={gen2StatusLabel(file.code)}
                  >
                    {file.code}
                  </code>
                  <span>{file.path}</span>
                  {overlapFor?.(file.path) ? (
                    <span
                      className="gen2-superset-change-overlap"
                      title={overlapFor(file.path)}
                    >
                      <GitCompareArrows aria-hidden="true" />
                      <span className="sr-only">{overlapFor(file.path)}</span>
                    </span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {mode === "review" && diff.trim() ? (
          <div className="gen2-review-diff">
            <ReviewDiffViewer patch={diff} layout={layout} />
          </div>
        ) : null}
        {mode === "changes" && loaded && !files.length && !error ? (
          <p className="gen2-superset-tool-empty">
            Edit a file on this branch to see it here.
          </p>
        ) : null}
        {mode === "review" && loaded && !diff.trim() && !error && !diffError ? (
          <p className="gen2-superset-tool-empty">
            {untracked.length && !files.some((file) => file.code !== "??")
              ? "New files have no diff until Git tracks them."
              : files.length
                ? "New files have no diff until Git tracks them."
                : "This branch has nothing to review yet."}
          </p>
        ) : null}
      </section>
    </TooltipProvider>
  );
}
