import type { ImportedConversationMessage } from "@codev/contracts";

export function buildSharedChatContext(
  messages: Pick<
    ImportedConversationMessage,
    "role" | "text" | "authorName" | "generation"
  >[],
  limit = 80_000,
  olderMessagesOmitted = false,
) {
  const parts: string[] = [];
  const omission = "[Older conversation content omitted.]\n\n";
  let remaining = Math.max(0, limit - omission.length);
  let omitted = olderMessagesOmitted;
  for (const message of [...messages].reverse()) {
    if (message.generation && message.generation.status !== "completed")
      continue;
    const text = `[${message.role}${message.authorName ? `: ${message.authorName}` : ""}]\n${message.text}\n\n`;
    if (text.length > remaining) {
      if (!parts.length) parts.unshift(text.slice(-remaining));
      omitted = true;
      break;
    }
    parts.unshift(text);
    remaining -= text.length;
  }
  return ((omitted ? omission : "") + parts.join("")).slice(-limit);
}

/** Ignore CLI diagnostics: they can contain authentication details. */
export function codexFinalMessage(output: string) {
  let final = "";
  for (const line of output.split(/\r?\n/)) {
    try {
      const event = JSON.parse(line);
      if (
        event.type === "item.completed" &&
        event.item?.type === "agent_message" &&
        typeof event.item.text === "string"
      )
        final = event.item.text;
    } catch {
      /* Non-JSON diagnostic. */
    }
  }
  return final.trim();
}
