"use client";

import type { ReactNode } from "react";
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
  exportActions,
}: {
  workspaceId: string;
  files: WorkspaceFile[];
  revisionToken: string;
  onRefresh: () => void;
  className?: string;
  /** Publish / Published ↗ controls — “share what you built” next to Preview. */
  exportActions?: ReactNode;
}) {
  const source = useMemo<PreviewSource | null>(
    () =>
      buildStaticPreviewSource(
        files.map((file) => file.path),
        revisionToken,
      ),
    [files, revisionToken],
  );

  if (!source) {
    return null;
  }

  const iframeSrc = iframeSrcForPreviewSource(workspaceId, source);
  const entryLabel =
    source.kind === "static" ? source.entryPath : source.proxyUrl;

  return (
    <section
      className={`preview-pane ${className}`.trim()}
      aria-label="Site preview"
    >
      <div className="preview-pane-head">
        <div className="preview-pane-title">
          <span>Preview</span>
          <small>Share what you built</small>
        </div>
        <div className="preview-pane-actions">
          {exportActions}
          <span className="preview-pane-badge" title={entryLabel}>
            {entryLabel}
          </span>
          <button
            type="button"
            className="preview-pane-refresh"
            onClick={onRefresh}
            aria-label="Refresh preview"
          >
            Refresh
          </button>
          <a
            className="preview-pane-refresh"
            href={iframeSrc}
            target="_blank"
            rel="noreferrer"
          >
            Open
          </a>
        </div>
      </div>
      <iframe
        className="preview-pane-frame"
        title="Workspace site preview"
        src={iframeSrc}
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
      />
    </section>
  );
}
