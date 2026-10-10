import "server-only";

import { formatGen2WorkspaceAgentPrompt } from "./workspace-agent-instructions";

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
  context?: string | undefined,
) {
  return [
    "codex",
    "exec",
    "--json",
    "--ephemeral",
    "--ignore-user-config",
    "--dangerously-bypass-hook-trust",
    "--skip-git-repo-check",
    "--sandbox",
    "danger-full-access",
    "-c",
    'approval_policy="never"',
    ...(model?.trim() ? ["--model", model.trim()] : []),
    "--cd",
    ".",
    formatGen2WorkspaceAgentPrompt(prompt, history, context),
  ];
}
