import "server-only";

import { formatGen2TurnPrompt } from "./chats-format";

export function buildGen2CursorCommand(
  prompt: string,
  history: Array<{ role: "user" | "assistant"; body: string }> = [],
  model?: string,
) {
  return [
    "cursor-agent",
    "--print",
    "--output-format",
    "stream-json",
    "--force",
    "--trust",
    "--model",
    model?.trim() || "auto",
    [
      "You are Cursor on this workspace's machine.",
      "Use the shell to inspect and change files in the current working directory.",
      "Answer the user and make requested code changes here.",
      "Do not inspect environment variables or files that hold credentials.",
      "",
      formatGen2TurnPrompt(prompt, history),
    ].join("\n"),
  ];
}
