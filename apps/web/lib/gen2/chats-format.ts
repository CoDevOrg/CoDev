export const GEN2_NEW_CHAT_TITLE = "New chat";

const MAX_HISTORY_MESSAGES = 20;
const MAX_HISTORY_CHARS = 12_000;

export function gen2ChatTitleFromPrompt(prompt: string) {
  const firstLine = prompt.trim().split(/\n/)[0] ?? "";
  const words = firstLine.split(/\s+/).filter(Boolean).slice(0, 8).join(" ");
  const title = words.slice(0, 80).trim();
  return title.length > 0 ? title : GEN2_NEW_CHAT_TITLE;
}

export function formatGen2TurnPrompt(
  prompt: string,
  history: Array<{ role: "user" | "assistant"; body: string }>,
) {
  const prior = history.slice(-MAX_HISTORY_MESSAGES);
  if (prior.length === 0) {
    return prompt;
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
  if (packed.length > MAX_HISTORY_CHARS) {
    packed = packed.slice(-MAX_HISTORY_CHARS);
  }
  return `${packed}\n\nCurrent request:\n${prompt}`;
}
