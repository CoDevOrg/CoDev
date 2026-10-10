"use client";

import type { Gen2ChatMessage } from "@codev/contracts";

import { parseGen2PromptCommand } from "@/lib/gen2/prompt-command";
import { WorkspaceButton } from "./workspace-button";

export const IMPLEMENT_PLAN_PROMPT = "Implement the plan above.";
export const FIX_FINDINGS_PROMPT = "Fix the findings from your review above.";

/** The command of the user message an assistant reply answered. */
function answeredCommand(messages: Gen2ChatMessage[], index: number) {
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const message = messages[cursor]!;
    if (message.role === "user")
      return parseGen2PromptCommand(message.body).command;
  }
  return null;
}

/**
 * What to do after a `/plan` or `/review` reply, offered under the latest
 * reply only. Buttons send a plain follow-up or refill the composer.
 */
export function ChatNextSteps({
  messages,
  index,
  onSend,
  onRefine,
}: {
  messages: Gen2ChatMessage[];
  index: number;
  onSend: (prompt: string) => void;
  onRefine: () => void;
}) {
  const command = answeredCommand(messages, index);
  if (command === "plan")
    return (
      <div className="gen2-chat-next" role="group" aria-label="Next steps">
        <WorkspaceButton
          tone="primary"
          onClick={() => onSend(IMPLEMENT_PLAN_PROMPT)}
        >
          Implement this plan
        </WorkspaceButton>
        <WorkspaceButton tone="secondary" onClick={onRefine}>
          Refine plan
        </WorkspaceButton>
      </div>
    );
  if (command === "review")
    return (
      <div className="gen2-chat-next" role="group" aria-label="Next steps">
        <WorkspaceButton
          tone="primary"
          onClick={() => onSend(FIX_FINDINGS_PROMPT)}
        >
          Fix these findings
        </WorkspaceButton>
      </div>
    );
  return null;
}
