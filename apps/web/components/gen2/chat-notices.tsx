"use client";

import { RefreshCw, X } from "lucide-react";
import type {
  Gen2PossibleDuplicateTask,
  Gen2WorkspaceDetail,
} from "@codev/contracts";

import { DuplicateTaskNotice } from "./duplicate-task-notice";
import { WorkspaceButton } from "./workspace-button";

/**
 * The notices above the composer: a possible duplicate of an active task,
 * then the turn error (or the model catalog's, with a retry).
 */
export function ChatNotices({
  duplicate,
  members,
  onOpenDuplicate,
  onStartAnyway,
  onDismissDuplicate,
  error,
  modelsError,
  onRetryModels,
  onDismissError,
}: {
  duplicate: Gen2PossibleDuplicateTask | null;
  members: Gen2WorkspaceDetail["members"];
  onOpenDuplicate: ((worktreeId: string) => void) | undefined;
  onStartAnyway: (runId: string) => void;
  onDismissDuplicate: () => void;
  error: string;
  modelsError: string | undefined;
  onRetryModels: () => void;
  onDismissError: () => void;
}) {
  const owner = members.find(
    (member) => member.userId === duplicate?.createdBy,
  );
  const retry = Boolean(modelsError) && !error;
  return (
    <>
      {duplicate ? (
        <DuplicateTaskNotice
          duplicate={duplicate}
          ownerLabel={owner?.name ?? owner?.login ?? "a member"}
          onOpen={
            onOpenDuplicate
              ? () => onOpenDuplicate(duplicate.worktreeId)
              : undefined
          }
          onStartAnyway={() => onStartAnyway(duplicate.runId)}
          onDismiss={onDismissDuplicate}
        />
      ) : null}
      {error || modelsError ? (
        <div className="gen2-chat-alert" role="alert">
          <span>{error || modelsError}</span>
          <WorkspaceButton
            size="icon"
            aria-label={retry ? "Retry model discovery" : "Dismiss error"}
            onClick={retry ? onRetryModels : onDismissError}
          >
            {retry ? (
              <RefreshCw aria-hidden="true" />
            ) : (
              <X aria-hidden="true" />
            )}
          </WorkspaceButton>
        </div>
      ) : null}
    </>
  );
}
