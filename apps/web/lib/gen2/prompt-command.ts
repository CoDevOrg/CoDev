/**
 * The agent commands a prompt may start with (`/plan …`). The command stays
 * in the persisted user message, so a continuation or restart that replays
 * the message keeps its mode. Shared by the composer and the server, so it
 * must stay free of server-only imports.
 */
export const GEN2_PROMPT_COMMANDS = [
  {
    id: "plan",
    label: "Plan",
    description: "Investigate and propose a plan without changing files",
    argHint: "what to plan",
    requiresText: true,
  },
  {
    id: "ask",
    label: "Ask",
    description: "Answer a question without changing files",
    argHint: "your question",
    requiresText: true,
  },
  {
    id: "goal",
    label: "Goal",
    description: "Set a goal for this chat and keep working toward it",
    argHint: "the outcome you want",
    requiresText: true,
  },
  {
    id: "review",
    label: "Review",
    description: "Review the uncommitted changes in this worktree",
    argHint: "optional focus",
    requiresText: false,
  },
  {
    id: "init",
    label: "Init",
    description: "Create or update AGENTS.md for this project",
    argHint: "",
    requiresText: false,
  },
] as const;

export type Gen2PromptCommandId = (typeof GEN2_PROMPT_COMMANDS)[number]["id"];

export type Gen2GoalControl = "clear" | "done";

const COMMAND = /^\/(plan|ask|goal|review|init)(?=\s|$)/i;
const GOAL_CONTROLS: Record<string, Gen2GoalControl> = {
  clear: "clear",
  off: "clear",
  done: "done",
  achieved: "done",
};

export function parseGen2PromptCommand(prompt: string): {
  command: Gen2PromptCommandId | null;
  text: string;
  goalControl: Gen2GoalControl | null;
} {
  const match = COMMAND.exec(prompt);
  if (!match) return { command: null, text: prompt, goalControl: null };
  const command = match[1]!.toLowerCase() as Gen2PromptCommandId;
  const text = prompt.slice(match[0].length).trim();
  const goalControl =
    command === "goal" ? (GOAL_CONTROLS[text.toLowerCase()] ?? null) : null;
  return { command, text, goalControl };
}

/** Puts the command first, so anything prepended to the body keeps its mode. */
export function withGen2PromptCommand(
  command: Gen2PromptCommandId | null,
  body: string,
) {
  const trimmed = body.trim();
  if (!command) return trimmed;
  return trimmed ? `/${command} ${trimmed}` : `/${command}`;
}
