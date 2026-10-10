"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import type { Gen2AgentProviderName, Gen2Chat } from "@codev/contracts";

import { cn } from "@/lib/platform/utils";
import { ChatProviderPicker } from "./chat-provider-picker";
import { WorkspaceButton } from "./workspace-button";

/**
 * New chat and recent chats, for a panel used outside the workspace shell
 * (the shell's sidebar owns both there). With several connected agents,
 * New chat asks which one to use.
 */
export function ChatPanelBar({
  chats,
  chatId,
  providers,
  onNewChat,
  onSelect,
}: {
  chats: Gen2Chat[];
  chatId: string | null;
  providers: Gen2AgentProviderName[];
  onNewChat: (provider: Gen2AgentProviderName) => void;
  onSelect: (chatId: string) => void;
}) {
  const [picking, setPicking] = useState(false);
  return (
    <header className="gen2-chat-panel-bar">
      <WorkspaceButton
        tone="secondary"
        size="toolbar"
        onClick={() =>
          providers.length === 1 ? onNewChat(providers[0]!) : setPicking(true)
        }
        disabled={providers.length === 0}
      >
        <Plus aria-hidden="true" /> New chat
      </WorkspaceButton>
      {chats.length > 0 ? (
        <nav className="gen2-chat-panel-tabs" aria-label="Chats">
          {chats.slice(0, 5).map((chat) => (
            <button
              key={chat.id}
              type="button"
              className={cn(
                "gen2-chat-panel-tab",
                chat.id === chatId && "is-current",
              )}
              aria-current={chat.id === chatId}
              onClick={() => onSelect(chat.id)}
              title={chat.title}
            >
              {chat.title}
            </button>
          ))}
        </nav>
      ) : null}
      <ChatProviderPicker
        open={picking}
        onOpenChange={setPicking}
        providers={providers}
        onChoose={onNewChat}
      />
    </header>
  );
}
