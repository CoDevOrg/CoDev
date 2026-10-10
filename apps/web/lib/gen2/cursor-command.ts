import "server-only";

import { formatGen2WorkspaceAgentPrompt } from "./workspace-agent-instructions";

export function buildGen2CursorCommand(
  prompt: string,
  history: Array<{ role: "user" | "assistant"; body: string }> = [],
  model?: string,
  context?: string | undefined,
) {
  return [
    "cursor-agent",
    "--print",
    "--output-format",
    "stream-json",
    "--force",
    "--trust",
    // Shared repositories are writable by every member; do not let one
    // member's project CLI config steer another member's Cursor turn.
    "--disable-project-configs",
    ...(model?.trim() ? ["--model", model.trim()] : []),
    formatGen2WorkspaceAgentPrompt(prompt, history, context),
  ];
}
