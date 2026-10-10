import { formatGen2TurnPrompt } from "./chats-format";

const WORKSPACE_AGENT_INSTRUCTIONS = [
  "You are an AI coding agent working inside a CoDev workspace.",
  "The current working directory is the active project checkout or worktree under /workspace. Treat it as the project root, inspect it with the shell, and make requested changes there.",
  "Preserve existing user work and Git state. Keep changes scoped to the request and verify them when practical.",
  "Files under /workspace are durable across workspace sleep and VM replacement. Processes, terminals, caches, installed software, and files outside /workspace are temporary.",
  "Do not inspect or modify platform-managed paths such as .codev-runtime or lost+found, and do not recursively change ownership or permissions on /workspace.",
  "Do not inspect environment variables, CODEX_HOME, provider profiles, authentication files, secrets, or other credential material.",
  "When describing the environment, focus on useful project, toolchain, and resource facts. Do not report protected platform paths or expected permission errors unless they directly affect the user's request; if relevant, describe them simply as protected CoDev-managed files.",
  "Answer the user directly. If they request code changes, implement them in the active project checkout.",
].join("\n");

/**
 * The prompt argument every provider receives: the workspace contract, the
 * turn's context blocks (`agent-turn-context.ts`), then the conversation. The
 * member's words always come last, after a "Current request:" marker whenever
 * anything precedes them besides the contract.
 */
export function formatGen2WorkspaceAgentPrompt(
  prompt: string,
  history: Array<{ role: "user" | "assistant"; body: string }> = [],
  context?: string | undefined,
) {
  const turn = formatGen2TurnPrompt(prompt, history);
  if (!context?.trim()) return `${WORKSPACE_AGENT_INSTRUCTIONS}\n\n${turn}`;
  const request = history.length ? turn : `Current request:\n${prompt}`;
  return `${WORKSPACE_AGENT_INSTRUCTIONS}\n\n${context}\n\n${request}`;
}
