"use client";

import type { ReactNode } from "react";

import {
  GEN2_PROMPT_COMMANDS,
  parseGen2PromptCommand,
} from "@/lib/gen2/prompt-command";
import {
  deserializeGen2Mentions,
  parseGen2MentionTokens,
} from "@/lib/gen2/prompt-mentions";

/** Text with mention tokens as inline `@label` chips. */
function withMentions(text: string) {
  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const token of parseGen2MentionTokens(text)) {
    // Repeats of a token are not listed; show those as plain `@label`.
    parts.push(deserializeGen2Mentions(text.slice(cursor, token.start)).text);
    parts.push(
      <span
        key={token.start}
        className="gen2-chat-mention"
        data-kind={token.kind}
        title={token.ref}
      >
        @{token.label}
      </span>,
    );
    cursor = token.end;
  }
  parts.push(deserializeGen2Mentions(text.slice(cursor)).text);
  return parts.filter((part) => part !== "");
}

/**
 * A sent message as the member wrote it: its mode (`/plan`) as a chip and
 * its mentions as inline chips instead of raw tokens.
 */
export function ChatMessageBody({ body }: { body: string }) {
  const { command, text } = parseGen2PromptCommand(body);
  const mode = GEN2_PROMPT_COMMANDS.find((entry) => entry.id === command);
  return (
    <>
      {mode ? (
        <span className="gen2-chat-mode" title={mode.description}>
          {mode.label}
        </span>
      ) : null}
      <p>{withMentions(mode ? text : body)}</p>
    </>
  );
}
