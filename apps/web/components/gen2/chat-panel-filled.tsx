"use client";

import type { ReactNode } from "react";

import { CHAT_VIEWER_COPY } from "./chat-empty-state";
import { ChatGoalBar } from "./chat-goal-bar";
import { ChatTranscript, type ChatLiveTurn } from "./chat-transcript";
import type { ChatPanelState } from "./use-chat-panel";
import { WorkspaceActionCards } from "./workspace-action-cards";

/** The live turn's bubble, shown only in the chat that turn belongs to. */
function liveTurn(panel: ChatPanelState): ChatLiveTurn | null {
  const { turn, sender, messages } = panel;
  if (!(turn.running && panel.ownsTurn) && !sender.starting) return null;
  return {
    items: turn.items,
    reply: turn.liveReply,
    starting:
      sender.starting &&
      !turn.running &&
      !messages.some((message) => message.role === "assistant"),
    actionToken: turn.liveActionNonce,
  };
}

/**
 * A chat with messages: the transcript, then the dock with the agent's
 * proposals, notices, the goal and the composer (or why a viewer has none).
 */
export function ChatPanelFilled({
  panel,
  composer,
  notices,
  onOpenFile,
}: {
  panel: ChatPanelState;
  composer: ReactNode;
  notices: ReactNode;
  onOpenFile: (path: string) => void;
}) {
  const { scroll, dispatch, goal, canEdit, busy } = panel;
  return (
    <div className="gen2-chat-filled">
      <ChatTranscript
        transcriptRef={panel.transcriptRef}
        onScroll={scroll.onScroll}
        showJump={scroll.showJump}
        onJump={scroll.jumpToLatest}
        importedFrom={panel.thread.importedFrom}
        chatId={panel.thread.chatId}
        messages={panel.messages}
        live={liveTurn(panel)}
        onOpenFile={onOpenFile}
        nextSteps={
          canEdit && !busy
            ? {
                onSend: panel.sendText,
                onRefine: () => panel.draft.fill("/plan "),
              }
            : null
        }
      />
      <div className="gen2-chat-dock">
        <WorkspaceActionCards
          pending={dispatch.pending}
          onResolve={dispatch.resolve}
        />
        {notices}
        {goal ? (
          <ChatGoalBar
            goal={goal}
            canEdit={canEdit}
            busy={busy}
            continuation={panel.continuation}
            onSend={panel.sendText}
          />
        ) : null}
        {composer ?? <p className="gen2-chat-viewer">{CHAT_VIEWER_COPY}</p>}
      </div>
    </div>
  );
}
