"use client";

import type { RefObject } from "react";
import { ArrowDown } from "lucide-react";
import type {
  Gen2ChatDetail,
  Gen2ChatMessage,
  Gen2TurnItem,
} from "@codev/contracts";

import { MarkdownContent } from "@/components/markdown/markdown-content";
import { cn } from "@/lib/platform/utils";
import { ChatMessageActions } from "./chat-message-actions";
import { ChatMessageBody } from "./chat-message-body";
import { ChatNextSteps } from "./chat-next-steps";
import { Gen2TurnActivity } from "./turn-activity";
import { WorkspaceButton } from "./workspace-button";

export type ChatLiveTurn = {
  items: Gen2TurnItem[];
  reply: string;
  /** Still starting: no output yet, and nothing the agent has said. */
  starting: boolean;
  /** This turn's action token, so its workspace actions can run. */
  actionToken: string | null;
};

type TranscriptProps = {
  transcriptRef: RefObject<HTMLDivElement | null>;
  onScroll: () => void;
  showJump: boolean;
  onJump: () => void;
  importedFrom: Gen2ChatDetail["importedFrom"];
  chatId: string | null;
  messages: Gen2ChatMessage[];
  live: ChatLiveTurn | null;
  onOpenFile: (path: string) => void;
  /** Offers next steps under the latest reply; null for viewers or mid-turn. */
  nextSteps: { onSend: (prompt: string) => void; onRefine: () => void } | null;
};

function ImportMarker({
  from,
}: {
  from: NonNullable<Gen2ChatDetail["importedFrom"]>;
}) {
  return (
    <li className="gen2-chat-import-marker">
      Imported from {from.provider === "codex" ? "Codex" : "Claude Code"}
      {from.startedAt
        ? ` · started ${new Date(from.startedAt).toLocaleDateString()}`
        : ""}
      . New turns use the recent messages as context.
    </li>
  );
}

function LiveTurn({
  live,
  chatId,
  onOpenFile,
}: {
  live: ChatLiveTurn;
  chatId: string | null;
  onOpenFile: (path: string) => void;
}) {
  // Passed by spread: turn-activity gains these props with the actions work.
  const actionProps = { chatId, actionToken: live.actionToken };
  return (
    <li data-role="assistant" className="gen2-chat-turn">
      <div className="gen2-chat-assistant">
        <Gen2TurnActivity
          items={live.items}
          onOpenFile={onOpenFile}
          live
          {...actionProps}
        />
        {live.reply ? (
          <MarkdownContent className="gen2-chat-markdown" text={live.reply} />
        ) : live.items.length === 0 ? (
          <div className="gen2-chat-thinking" role="status">
            {live.starting ? "Starting the agent…" : "Thinking…"}
          </div>
        ) : null}
      </div>
    </li>
  );
}

/** The saved conversation, then the live turn while one runs. */
export function ChatTranscript({
  transcriptRef,
  messages,
  chatId,
  onOpenFile,
  nextSteps,
  ...props
}: TranscriptProps) {
  const last = messages.length - 1;
  return (
    <div className="gen2-chat-transcript-wrap">
      <div
        ref={transcriptRef}
        className="gen2-chat-transcript"
        onScroll={props.onScroll}
      >
        <ol className="gen2-chat-thread">
          {props.importedFrom ? (
            <ImportMarker from={props.importedFrom} />
          ) : null}
          {messages.map((message, index) => (
            <li
              key={message.id}
              data-role={message.role}
              className={cn(
                "gen2-chat-turn",
                message.role === "user" && "gen2-chat-turn-user",
              )}
            >
              {message.role === "user" ? (
                <div className="gen2-chat-user">
                  <ChatMessageBody body={message.body} />
                </div>
              ) : (
                <div className="gen2-chat-assistant">
                  {message.items?.length ? (
                    <Gen2TurnActivity
                      items={message.items}
                      settled
                      onOpenFile={onOpenFile}
                      {...{ chatId }}
                    />
                  ) : null}
                  <MarkdownContent
                    className="gen2-chat-markdown"
                    text={message.body}
                  />
                  <ChatMessageActions text={message.body} />
                  {nextSteps && index === last ? (
                    <ChatNextSteps
                      messages={messages}
                      index={index}
                      {...nextSteps}
                    />
                  ) : null}
                </div>
              )}
            </li>
          ))}
          {props.live ? (
            <LiveTurn
              live={props.live}
              chatId={chatId}
              onOpenFile={onOpenFile}
            />
          ) : null}
        </ol>
      </div>
      {props.showJump ? (
        <div className="gen2-chat-jump">
          <WorkspaceButton
            tone="secondary"
            size="toolbar"
            onClick={props.onJump}
          >
            <ArrowDown aria-hidden="true" />
            Jump to latest
          </WorkspaceButton>
        </div>
      ) : null}
    </div>
  );
}
