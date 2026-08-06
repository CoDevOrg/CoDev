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
  runtimeReady = true,
}: {
  workspaceId: string;
  files: WorkspaceFile[];
  revisionToken: string;
  onRefresh: () => void;
  className?: string;
  /** Publish / Published ↗ controls — “share what you built” next to Preview. */
  exportActions?: ReactNode;
  runtimeReady?: boolean;
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
    source?.kind === "static"
      ? source.entryPath
      : source?.kind === "live"
        ? source.proxyUrl
        : null;

  return (
    <section
      className={`preview-pane ${className}`.trim()}
      aria-label="Site preview"
    >
      <div className="preview-pane-head">
        <div className="preview-pane-title">
          <span>Web Workspace</span>
          <small>
            {entryLabel
              ? "Static preview from the sandbox"
              : "Waiting for a preview entry"}
          </small>
        </div>
        <div className="preview-pane-actions">
          {source ? exportActions : null}
          {entryLabel ? (
            <span className="preview-pane-badge" title={entryLabel}>
              {entryLabel}
            </span>
          ) : null}
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
          <h2>No preview entry yet</h2>
          <p>
            {runtimeReady
              ? "Add an index.html at the repo root, or in public/ or docs/, then refresh. Agents can create one for you from the console."
              : "Start the sandbox runtime, then add an index.html (root, public/, or docs/) to preview the site here."}
          </p>
          <ul>
            <li>
              <code>index.html</code>
            </li>
            <li>
              <code>public/index.html</code>
            </li>
            <li>
              <code>docs/index.html</code>
            </li>
          </ul>
        </div>
      )}
    </section>
  );
}
