"use client";

import { TooltipProvider } from "@/components/ui/tooltip";
import { ChatPanelBar } from "./chat-panel-bar";
import { ChatPanelComposer } from "./chat-panel-composer";
import { ChatPanelEmpty } from "./chat-panel-empty";
import { ChatPanelFilled } from "./chat-panel-filled";
import { ChatPanelNotices } from "./chat-panel-notices";
import { useChatPanel, type ChatPanelInput } from "./use-chat-panel";

export type Gen2ChatPanelProps = ChatPanelInput & {
  onOpenFile: (path: string) => void;
  hideChatBar?: boolean | undefined;
  onOpenWorktree?: ((worktreeId: string) => void) | undefined;
  /** Opens the workspace's settings so an account connects in place. */
  onOpenSettings?: (() => void) | undefined;
};

export function Gen2ChatPanel(props: Gen2ChatPanelProps) {
  const { onOpenSettings } = props;
  const panel = useChatPanel(props);
  const { thread, models } = panel;
  const composer = panel.canEdit ? (
    <ChatPanelComposer panel={panel} onOpenSettings={onOpenSettings} />
  ) : null;
  const notices = (
    <ChatPanelNotices panel={panel} onOpenWorktree={props.onOpenWorktree} />
  );
  const parts = { panel, composer, notices };

  return (
    <TooltipProvider delayDuration={300}>
      <section className="gen2-chat-panel" aria-label="Agent chat">
        {!props.hideChatBar ? (
          <ChatPanelBar
            chats={thread.chats}
            chatId={thread.chatId}
            providers={models.availableProviders}
            onNewChat={(choice) => void panel.newChat(choice)}
            onSelect={(id) => {
              thread.setChatId(id);
              props.onSelectChatId?.(id);
              panel.scroll.pinToLatest();
            }}
          />
        ) : null}
        {panel.empty ? (
          <ChatPanelEmpty {...parts} onOpenSettings={onOpenSettings} />
        ) : (
          <ChatPanelFilled {...parts} onOpenFile={props.onOpenFile} />
        )}
        <div className="gen2-composer-sr-only" aria-live="polite">
          {panel.dispatch.announcement}
        </div>
      </section>
    </TooltipProvider>
  );
}
