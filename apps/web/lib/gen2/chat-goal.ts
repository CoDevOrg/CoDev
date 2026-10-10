import type { Gen2ChatGoal, Gen2TurnItem } from "@codev/contracts";

import { parseGen2PromptCommand } from "./prompt-command";

const MAX_GOAL_CHARS = 1_000;

type GoalMessage = {
  role: "user" | "assistant";
  body: string;
  items?: Gen2TurnItem[] | null | undefined;
};

/**
 * A chat's goal, read from its transcript: the latest `/goal <text>` sets it,
 * `/goal clear` ends it, and `/goal done` or the agent's `update_goal` action
 * marks it achieved. Deriving it means no column to migrate, and a turn the
 * server settles with no browser open still updates it. Shared by the
 * composer and the server.
 */
export function deriveGen2ChatGoal(
  messages: GoalMessage[],
): Gen2ChatGoal | null {
  return messages.reduce<Gen2ChatGoal | null>(nextGoal, null);
}

function nextGoal(
  goal: Gen2ChatGoal | null,
  message: GoalMessage,
): Gen2ChatGoal | null {
  if (message.role === "assistant") {
    const summary = goal?.status === "active" ? reported(message.items) : null;
    return goal && summary !== null
      ? { ...goal, status: "achieved", summary: summary || null }
      : goal;
  }
  const { command, text, goalControl } = parseGen2PromptCommand(message.body);
  if (command !== "goal") return goal;
  if (goalControl === "clear") return null;
  if (goalControl === "done") return goal && { ...goal, status: "achieved" };
  if (!text) return goal;
  return {
    text: text.slice(0, MAX_GOAL_CHARS),
    status: "active",
    summary: null,
  };
}

/** The agent's achievement summary ("" when it gave none), or null. */
function reported(items: Gen2TurnItem[] | null | undefined) {
  for (const item of items ?? []) {
    if (item.kind === "workspaceAction" && item.action?.type === "update_goal")
      return item.action.summary?.slice(0, 500) ?? "";
  }
  return null;
}
