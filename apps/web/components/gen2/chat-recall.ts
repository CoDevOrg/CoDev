import {
  parseGen2PromptCommand,
  withGen2PromptCommand,
} from "@/lib/gen2/prompt-command";

const ATTACHMENTS = /^Attached files on this machine:\n(?:- `[^`\n]*`\n?)+\n*/;

/**
 * A sent message as the member typed it, for Up-arrow recall: the command
 * and mention tokens stay (the composer shows tokens as `@label`), and the
 * attachment list the composer added goes, since the files are not reattached.
 */
export function recallableChatText(body: string) {
  const { command, text } = parseGen2PromptCommand(body);
  const rest = text.replace(ATTACHMENTS, "");
  return withGen2PromptCommand(
    command,
    rest === "Please inspect these files." && rest !== text ? "" : rest,
  );
}
