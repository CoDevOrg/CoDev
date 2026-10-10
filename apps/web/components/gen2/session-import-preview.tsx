"use client";

import type { Gen2SessionImportPreview } from "@codev/contracts";
import { MarkdownContent } from "@/components/markdown/markdown-content";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

import { SESSION_SOURCES } from "./session-import-sources";

/** What an uploaded session will become, shown before the member confirms. */
export function SessionImportPreview({
  preview,
}: {
  preview: Gen2SessionImportPreview;
}) {
  const hidden = preview.redactions.reduce((sum, r) => sum + r.count, 0);
  const repo = [preview.repo.branch, preview.repo.commit?.slice(0, 7)]
    .filter(Boolean)
    .join(" @ ");
  return (
    <div className="gen2-session-import-preview">
      <p className="gen2-session-import-stats">
        {preview.messageCount} messages · {preview.itemCount} tool steps
        {preview.startedAt
          ? ` · started ${new Date(preview.startedAt).toLocaleString()}`
          : ""}
        {repo ? ` · ${repo}` : ""}
      </p>
      {hidden > 0 ? (
        <Alert>
          <AlertTitle>{hidden} secrets hidden</AlertTitle>
          <AlertDescription>
            {preview.redactions.map((r) => `${r.count} ${r.kind}`).join(", ")}{" "}
            were replaced with [REDACTED] before saving.
          </AlertDescription>
        </Alert>
      ) : null}
      {preview.editedFiles.length > 0 ? (
        <Alert>
          <AlertTitle>
            The session changed {preview.editedFiles.length} files
          </AlertTitle>
          <AlertDescription>
            Only the conversation is imported. Push any uncommitted local
            changes so this workspace can see them.
          </AlertDescription>
        </Alert>
      ) : null}
      <ol className="gen2-session-import-sample" aria-label="Sample messages">
        {preview.sample.map((message, index) => (
          <li key={index} data-role={message.role}>
            <span className="gen2-session-import-role">
              {message.role === "user"
                ? "You"
                : SESSION_SOURCES[preview.provider].label}
            </span>
            <MarkdownContent
              className="gen2-chat-markdown"
              text={
                message.body.length > 600
                  ? `${message.body.slice(0, 600)}…`
                  : message.body
              }
            />
          </li>
        ))}
      </ol>
    </div>
  );
}
