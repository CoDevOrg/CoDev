"use client";

import type { ReactNode } from "react";

import { rankChatEmptyCards } from "./chat-empty-cards";
import { ChatEmptyState } from "./chat-empty-state";
import { Gen2ConnectProvider } from "./connect-provider";
import type { ChatPanelState } from "./use-chat-panel";

/** A chat with no messages yet: the empty state around the composer. */
export function ChatPanelEmpty({
  panel,
  composer,
  notices,
  onOpenSettings,
}: {
  panel: ChatPanelState;
  composer: ReactNode;
  notices: ReactNode;
  onOpenSettings: (() => void) | undefined;
}) {
  const { models, agentContext } = panel;
  const { agent, provider } = models;
  return (
    <ChatEmptyState
      agentLabel={models.agentLabel}
      viewer={!panel.canEdit}
      connected={models.availableProviders.includes(agent)}
      workspaceAware={agentContext !== null}
      previewEnabled={agentContext?.previewEnabled ?? false}
      cards={rankChatEmptyCards(
        agentContext,
        panel.thread.chatId,
        panel.workspace.members.length,
      )}
      onCard={(card) => panel.draft.fill(card.text)}
      composer={
        <>
          {composer}
          {notices}
        </>
      }
      connect={
        provider !== null && !provider.connected ? (
          <Gen2ConnectProvider
            agent={agent}
            onConnected={() => void models.refreshProvider()}
            onOpenSettings={onOpenSettings}
          />
        ) : null
      }
    />
  );
}
