"use client";

import type { ReactNode } from "react";

import type { ChatEmptyCard } from "./chat-empty-cards";

/** Why a viewer gets no composer, here and under a chat's transcript. */
export const CHAT_VIEWER_COPY =
  "You can view this workspace. Ask an owner for edit access to run agents.";

function capabilities(previewEnabled: boolean) {
  const actions = [
    "open files",
    "review changes",
    "create branches",
    "invite teammates",
    ...(previewEnabled ? ["preview your app"] : []),
  ];
  return `${actions.slice(0, -1).join(", ")}, and ${actions.at(-1)}`;
}

function intro({
  agentLabel,
  viewer,
  connected,
  workspaceAware,
  previewEnabled,
}: {
  agentLabel: string;
  viewer: boolean;
  connected: boolean;
  workspaceAware: boolean;
  previewEnabled: boolean;
}) {
  if (viewer) return CHAT_VIEWER_COPY;
  if (!connected)
    return "Connect Codex or Claude to start a chat in this workspace.";
  const base = `${agentLabel} works in this cloud workspace with you. It edits code and runs commands`;
  return workspaceAware
    ? `${base}, and it can ${capabilities(previewEnabled)}.`
    : `${base}.`;
}

/**
 * A new chat: what the agent can do here, the composer, and suggestions
 * ranked by the workspace's state. Viewers get an explanation instead of a
 * composer they could not use.
 */
export function ChatEmptyState({
  cards,
  onCard,
  composer,
  connect,
  ...copy
}: {
  agentLabel: string;
  viewer: boolean;
  connected: boolean;
  workspaceAware: boolean;
  previewEnabled: boolean;
  cards: ChatEmptyCard[];
  onCard: (card: ChatEmptyCard) => void;
  /** The composer with its notices. */
  composer: ReactNode;
  /** Shown instead of the composer while the agent's account is missing. */
  connect: ReactNode;
}) {
  return (
    <div className="gen2-chat-empty">
      <div className="gen2-chat-empty-inner">
        <div className="gen2-chat-empty-intro">
          <h2>What should we build?</h2>
          <p className="gen2-chat-empty-copy">{intro(copy)}</p>
        </div>
        {copy.viewer
          ? null
          : (connect ?? (
              <>
                {composer}
                <div className="gen2-chat-suggestions">
                  {cards.map((card) => (
                    <button
                      key={card.id}
                      type="button"
                      className="gen2-chat-suggestion"
                      onClick={() => onCard(card)}
                    >
                      <span className="gen2-chat-suggestion-title">
                        {card.title}
                      </span>
                      <span className="gen2-chat-suggestion-desc">
                        {card.description}
                      </span>
                    </button>
                  ))}
                </div>
              </>
            ))}
      </div>
    </div>
  );
}
