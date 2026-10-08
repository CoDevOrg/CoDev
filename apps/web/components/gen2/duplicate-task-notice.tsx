"use client";

import type { Gen2PossibleDuplicateTask } from "@codev/contracts";
import { X } from "lucide-react";

import { WorkspaceButton } from "./workspace-button";

/**
 * Shown above the composer when a new task looks like an active one. The
 * typed prompt stays in the composer until the member chooses.
 */
export function DuplicateTaskNotice({
  duplicate,
  ownerLabel,
  onOpen,
  onStartAnyway,
  onDismiss,
}: {
  duplicate: Gen2PossibleDuplicateTask;
  ownerLabel: string;
  onOpen?: (() => void) | undefined;
  onStartAnyway: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="gen2-chat-duplicate" role="status">
      <div className="gen2-chat-duplicate-body">
        <p>
          A similar task is already {duplicate.status} on{" "}
          <span className="gen2-chat-duplicate-branch">
            {duplicate.worktreeId}
          </span>{" "}
          ({duplicate.provider}, {ownerLabel}).
        </p>
        <p className="gen2-chat-duplicate-task" title={duplicate.task}>
          {duplicate.task}
        </p>
      </div>
      <div className="gen2-chat-duplicate-actions">
        {onOpen ? (
          <WorkspaceButton tone="secondary" type="button" onClick={onOpen}>
            Open session
          </WorkspaceButton>
        ) : null}
        <WorkspaceButton tone="primary" type="button" onClick={onStartAnyway}>
          Start anyway
        </WorkspaceButton>
        <WorkspaceButton
          size="icon"
          type="button"
          aria-label="Dismiss similar task warning"
          onClick={onDismiss}
        >
          <X aria-hidden="true" />
        </WorkspaceButton>
      </div>
    </div>
  );
}
