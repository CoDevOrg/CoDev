"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { WorkspaceButton } from "./workspace-button";

/** The actions under an assistant reply; today, copying it. */
export function ChatMessageActions({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="gen2-chat-message-actions">
      <Tooltip>
        <TooltipTrigger asChild>
          <WorkspaceButton
            size="icon"
            type="button"
            aria-label="Copy message"
            onClick={() => {
              void navigator.clipboard.writeText(text);
              setCopied(true);
              window.setTimeout(() => setCopied(false), 2000);
            }}
          >
            {copied ? (
              <Check aria-hidden="true" />
            ) : (
              <Copy aria-hidden="true" />
            )}
          </WorkspaceButton>
        </TooltipTrigger>
        <TooltipContent className="gen2-workspace-surface">
          {copied ? "Copied" : "Copy"}
        </TooltipContent>
      </Tooltip>
    </div>
  );
}
