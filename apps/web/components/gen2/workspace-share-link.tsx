"use client";

import { useEffect, useState } from "react";
import { Check, Copy, Link2 } from "lucide-react";
import type { Gen2WorkspaceRole } from "@codev/contracts";

import { Skeleton } from "@/components/ui/skeleton";
import { useScrambleText } from "./use-scramble-text";
import { WorkspaceButton } from "./workspace-button";

/**
 * The reusable group link: its join role, the URL, and a copy action. Viewers
 * see that the link exists but cannot create, change, or copy it.
 */
export function WorkspaceShareLink({
  canShare,
  url,
  role,
  loading,
  error,
  onRoleChange,
  onRetry,
  onCopyFailed,
}: {
  canShare: boolean;
  url: string;
  role: Gen2WorkspaceRole;
  loading: boolean;
  error: string;
  onRoleChange: (role: Gen2WorkspaceRole) => void;
  onRetry: () => void;
  onCopyFailed: () => void;
}) {
  // A regenerated link resolves from scrambled characters; copying uses the real one.
  const shownUrl = useScrambleText(url);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timeout = setTimeout(() => setCopied(false), 2_500);
    return () => clearTimeout(timeout);
  }, [copied]);

  async function copy() {
    if (!url || loading) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setCopied(false);
      onCopyFailed();
    }
  }

  return (
    <section className="gen2-share-link" aria-labelledby="share-link">
      <div className="gen2-share-link-head">
        <span className="gen2-share-link-icon" aria-hidden="true">
          <Link2 />
        </span>
        <span className="gen2-share-link-copy">
          <h3 id="share-link">Anyone with the link</h3>
          <span>
            {canShare
              ? "Can join as the selected role. The link expires in 7 days; changing the role replaces it."
              : "Only editors and the owner can share a link."}
          </span>
        </span>
        {canShare ? (
          <select
            value={role}
            onChange={(event) =>
              onRoleChange(event.target.value as Gen2WorkspaceRole)
            }
            disabled={loading}
            className="gen2-workspace-select"
            aria-label="Link access role"
          >
            <option value="editor">Editor</option>
            <option value="viewer">Viewer</option>
          </select>
        ) : null}
      </div>

      {error ? (
        <div className="gen2-share-notice" data-type="error" role="alert">
          <span>{error}</span>
          {canShare ? (
            <WorkspaceButton
              tone="secondary"
              type="button"
              onClick={onRetry}
              disabled={loading}
            >
              Retry
            </WorkspaceButton>
          ) : null}
        </div>
      ) : null}

      {canShare && !error ? (
        <div className="gen2-share-link-row">
          {url ? (
            <input
              readOnly
              value={shownUrl}
              aria-label="Share link"
              className="gen2-share-link-url"
              onFocus={(event) => event.currentTarget.select()}
            />
          ) : (
            <Skeleton className="gen2-share-link-skeleton" />
          )}
          <WorkspaceButton
            type="button"
            tone="secondary"
            onClick={() => void copy()}
            disabled={!url || loading}
          >
            {copied ? (
              <Check data-icon="inline-start" aria-hidden="true" />
            ) : (
              <Copy data-icon="inline-start" aria-hidden="true" />
            )}
            {copied ? "Copied" : "Copy link"}
          </WorkspaceButton>
          <span className="sr-only" role="status">
            {copied ? "Link copied to clipboard" : ""}
          </span>
        </div>
      ) : null}
    </section>
  );
}
