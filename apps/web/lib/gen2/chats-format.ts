export const GEN2_NEW_CHAT_TITLE = "New chat";

export const GEN2_CONTEXT_MAX_MESSAGES = 20;
export const GEN2_CONTEXT_MAX_CHARACTERS = 12_000;

type ContextMessage = {
  id?: string;
  role: "user" | "assistant";
  body: string;
};

export function gen2ChatTitleFromPrompt(prompt: string) {
  const firstLine = prompt.trim().split(/\n/)[0] ?? "";
  const words = firstLine.split(/\s+/).filter(Boolean).slice(0, 8).join(" ");
  const title = words.slice(0, 80).trim();
  return title.length > 0 ? title : GEN2_NEW_CHAT_TITLE;
}

export function formatGen2TurnPrompt(
  prompt: string,
  history: ContextMessage[],
) {
  return buildGen2Context(prompt, history).prompt;
}

/**
 * Builds both the exact prompt supplied to Codex and the inspectable context
 * selection. Keeping the two together prevents preview and execution drift.
 */
export function buildGen2Context(prompt: string, history: ContextMessage[]) {
  const prior = history.slice(-GEN2_CONTEXT_MAX_MESSAGES);
  if (prior.length === 0) {
    return {
      prompt,
      messageIds: [],
      messageCount: 0,
      maxMessages: GEN2_CONTEXT_MAX_MESSAGES,
      maxCharacters: GEN2_CONTEXT_MAX_CHARACTERS,
    } as const;
  }
  const lines = [
    "Continue this conversation. Use the previous turns as context.",
    "",
    "Previous conversation on this chat:",
  ];
  for (const message of prior) {
    lines.push(
      `${message.role === "user" ? "User" : "Codex"}: ${message.body}`,
    );
  }
  let packed = lines.join("\n");
  if (packed.length > GEN2_CONTEXT_MAX_CHARACTERS) {
    packed = packed.slice(-GEN2_CONTEXT_MAX_CHARACTERS);
  }
  return {
    prompt: `${packed}\n\nCurrent request:\n${prompt}`,
    messageIds: prior.map((message, index) => message.id ?? `message-${index}`),
    messageCount: prior.length,
    maxMessages: GEN2_CONTEXT_MAX_MESSAGES,
    maxCharacters: GEN2_CONTEXT_MAX_CHARACTERS,
  } as const;
}
