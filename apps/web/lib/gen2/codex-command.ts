import "server-only";

import { getAgentModel } from "../providers/ai-model";
import { formatGen2TurnPrompt } from "./chats-format";

/**
 * Shared by the direct `codex exec` sandbox path (`agent.ts`) and the
 * Superset terminal-agent path (`superset-agent-runtime.ts`): both deliver
 * the same Codex invocation, just through a different launch mechanism. Split
 * out so neither module has to import the other for it.
 */
export function buildGen2CodexCommand(
  prompt: string,
  history: Array<{ role: "user" | "assistant"; body: string }> = [],
  model?: string,
) {
  return [
    "codex",
    "exec",
    "--json",
    "--ephemeral",
    "--ignore-user-config",
    "--skip-git-repo-check",
    "--sandbox",
    "danger-full-access",
    "-c",
    'approval_policy="never"',
    "--model",
    model?.trim() || getAgentModel("openai"),
    "--cd",
    ".",
    [
      "You are Codex on this workspace's Firecracker machine.",
      "The working directory is /workspace. Use the shell to inspect and change files there.",
      "Answer the user. If they ask for code changes, make them in the current directory.",
      "Do not inspect CODEX_HOME or authentication files.",
      "",
      formatGen2TurnPrompt(prompt, history),
    ].join("\n"),
  ];
}
