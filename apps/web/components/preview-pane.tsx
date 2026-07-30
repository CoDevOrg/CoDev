"use client";

import type { ReactNode } from "react";
import { useMemo } from "react";

import type { WorkspaceFile } from "@/lib/ide";
import {
  buildStaticPreviewSource,
  iframeSrcForPreviewSource,
  type PreviewSource,
} from "@/lib/preview";

function PreviewWaitingIllustration() {
  return (
    <svg
      className="preview-pane-empty-art"
      viewBox="0 0 120 88"
      width="120"
      height="88"
      aria-hidden="true"
    >
      <rect
        x="8"
        y="10"
        width="104"
        height="68"
        rx="8"
        fill="rgba(70, 230, 193, 0.04)"
        stroke="rgba(70, 230, 193, 0.18)"
        strokeWidth="1.5"
      />
      <rect
        x="18"
        y="20"
        width="40"
        height="6"
        rx="3"
        fill="rgba(155, 165, 161, 0.35)"
      />
      <rect
        x="18"
        y="34"
        width="84"
        height="4"
        rx="2"
        fill="rgba(155, 165, 161, 0.22)"
      />
      <rect
        x="18"
        y="44"
        width="68"
        height="4"
        rx="2"
        fill="rgba(155, 165, 161, 0.18)"
      />
      <rect
        x="18"
        y="54"
        width="52"
        height="4"
        rx="2"
        fill="rgba(155, 165, 161, 0.14)"
      />
      <circle cx="96" cy="58" r="10" fill="rgba(70, 230, 193, 0.12)" />
      <path
        d="M92 58h8M96 54v8"
        stroke="rgba(70, 230, 193, 0.55)"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </svg>
  );
}

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
        <div className="preview-pane-title">
          <span>Preview</span>
          <small>Share what you built</small>
        </div>
        <div className="preview-pane-actions">
          {exportActions}
          {entryLabel ? (
            <span className="preview-pane-badge" title={entryLabel}>
              {entryLabel}
            </span>
          ) : (
            <span className="preview-pane-badge">Waiting</span>
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
        <div className="preview-pane-empty" role="status">
          <div className="preview-pane-empty-panel">
            <PreviewWaitingIllustration />
            <strong>Nothing to show yet</strong>
            <p>
              Ask the agent in chat to build a page — once there is an{" "}
              <code>index.html</code> (or one in <code>public/</code> /{" "}
              <code>docs/</code>), the live preview appears here.
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
