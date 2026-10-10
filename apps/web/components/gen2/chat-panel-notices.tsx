"use client";

import { ChatNotices } from "./chat-notices";
import type { ChatPanelState } from "./use-chat-panel";

/** The panel's notices: a possible duplicate task, then any error. */
export function ChatPanelNotices({
  panel,
  onOpenWorktree,
}: {
  panel: ChatPanelState;
  onOpenWorktree: ((worktreeId: string) => void) | undefined;
}) {
  const { setPossibleDuplicate, textareaRef, models } = panel;
  const focusComposer = () => textareaRef.current?.focus();
  return (
    <ChatNotices
      duplicate={panel.possibleDuplicate}
      members={panel.workspace.members}
      onOpenDuplicate={
        onOpenWorktree &&
        ((id) => {
          onOpenWorktree(id);
          setPossibleDuplicate(null);
          focusComposer();
        })
      }
      onStartAnyway={(runId) => {
        panel.sender.acknowledgeDuplicate(runId);
        setPossibleDuplicate(null);
        panel.draft.submit();
      }}
      onDismissDuplicate={() => {
        setPossibleDuplicate(null);
        focusComposer();
      }}
      error={panel.error}
      modelsError={models.provider?.modelsError}
      onRetryModels={() => void models.refreshProvider()}
      onDismissError={() => panel.setError("")}
    />
  );
}
