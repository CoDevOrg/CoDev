"use client";

import { useMemo } from "react";

import type { WorkspaceFile } from "@/lib/ide";
import {
  buildStaticPreviewSource,
  iframeSrcForPreviewSource,
  type PreviewSource,
} from "@/lib/preview";

export function PreviewPane({
  workspaceId,
  files,
  revisionToken,
  onRefresh,
  className = "",
}: {
  workspaceId: string;
  files: WorkspaceFile[];
  revisionToken: string;
  onRefresh: () => void;
  className?: string;
}) {
  const source = useMemo<PreviewSource | null>(
    () =>
      buildStaticPreviewSource(
        files.map((file) => file.path),
        revisionToken,
      ),
    [files, revisionToken],
  );

  const iframeSrc = source
    ? iframeSrcForPreviewSource(workspaceId, source)
    : null;
  const entryLabel =
    source?.kind === "static" ? source.entryPath : source?.proxyUrl;

  return (
    <section
      className={`preview-pane ${className}`.trim()}
      aria-label="Site preview"
    >
      <div className="preview-pane-head">
        <span>Preview</span>
        <div className="preview-pane-actions">
          {entryLabel ? (
            <span className="preview-pane-badge" title={entryLabel}>
              {entryLabel}
            </span>
          ) : (
            <span className="preview-pane-badge">No site</span>
          )}
          <button
            type="button"
            className="preview-pane-refresh"
            onClick={onRefresh}
            aria-label="Refresh preview"
          >
            Refresh
          </button>
          {iframeSrc ? (
            <a
              className="preview-pane-refresh"
              href={iframeSrc}
              target="_blank"
              rel="noreferrer"
            >
              Open
            </a>
          ) : null}
        </div>
      </div>
      {iframeSrc ? (
        <iframe
          className="preview-pane-frame"
          title="Workspace site preview"
          src={iframeSrc}
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
        />
      ) : (
        <div className="preview-pane-empty">
          <strong>No site yet</strong>
          <p>
            Ask the agent to create an <code>index.html</code> (or put one in{" "}
            <code>public/</code> / <code>docs/</code>) and the preview will
            appear here.
          </p>
        </div>
      )}
    </section>
  );
}
