"use client";

import { useId, useRef, type ReactNode } from "react";
import { ArrowUp, Paperclip, Square } from "lucide-react";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ChatDictationButton } from "./chat-dictation-button";
import type { Dictation } from "./use-dictation";
import { WorkspaceButton } from "./workspace-button";

function WithTooltip({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent className="gen2-workspace-surface">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

/** Attach, dictate, the agent picker, and Send or Stop. */
export function ChatComposerToolbar({
  agentPicker,
  dictation,
  running,
  canSend,
  agentLabel,
  onFiles,
  onStop,
}: {
  agentPicker: ReactNode;
  dictation: Dictation;
  running: boolean;
  canSend: boolean;
  agentLabel: string;
  onFiles: (files: FileList | null) => void;
  onStop: () => void;
}) {
  const inputId = useId();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  return (
    <div className="gen2-chat-composer-toolbar">
      <input
        ref={fileInputRef}
        id={inputId}
        type="file"
        multiple
        className="gen2-composer-file-input"
        aria-label="Choose files to attach"
        onChange={(event) => {
          onFiles(event.target.files);
          event.target.value = "";
        }}
      />
      <div className="gen2-composer-tools">
        <WithTooltip label="Attach files (max 5, 1MB each)">
          <WorkspaceButton
            size="icon"
            aria-label="Attach files"
            onClick={() => fileInputRef.current?.click()}
          >
            <Paperclip aria-hidden="true" />
          </WorkspaceButton>
        </WithTooltip>
        <ChatDictationButton dictation={dictation} />
      </div>
      <div className="gen2-chat-composer-actions">
        {agentPicker}
        {running ? (
          <WithTooltip label="Stop">
            <WorkspaceButton
              size="icon"
              tone="primary"
              onClick={onStop}
              aria-label={`Stop ${agentLabel}`}
            >
              <Square aria-hidden="true" />
            </WorkspaceButton>
          </WithTooltip>
        ) : (
          <WithTooltip label="Send">
            <WorkspaceButton
              type="submit"
              size="icon"
              tone="primary"
              disabled={!canSend}
              aria-label="Send"
            >
              <ArrowUp aria-hidden="true" />
            </WorkspaceButton>
          </WithTooltip>
        )}
      </div>
    </div>
  );
}
