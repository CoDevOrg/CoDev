import "server-only";

import { formatGen2WorkspaceAgentPrompt } from "./workspace-agent-instructions";

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
    ...(model?.trim() ? ["--model", model.trim()] : []),
    formatGen2WorkspaceAgentPrompt(prompt, history),
  ];
}
