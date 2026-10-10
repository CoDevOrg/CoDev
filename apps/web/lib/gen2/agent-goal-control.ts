import "server-only";

import type { Gen2ChatGoal } from "@codev/contracts";

import { deriveGen2ChatGoal } from "./chat-goal";
import {
  appendGen2ChatMessage,
  listGen2ChatMessages,
  requireGen2Chat,
} from "./chats";

/**
 * `/goal clear` and `/goal done` change the chat's goal without running an
 * agent. The goal is derived from the transcript, so recording the member's
 * message is the whole change; the caller has already rejected viewers.
 */
export async function applyGen2GoalControl(input: {
  workspaceId: string;
  chatId: string;
  prompt: string;
}): Promise<{ goal: Gen2ChatGoal | null }> {
  // The listing is used only once the chat is known to be in this workspace.
  const [, messages] = await Promise.all([
    requireGen2Chat(input.workspaceId, input.chatId),
    listGen2ChatMessages(input.chatId),
  ]);
  await appendGen2ChatMessage({
    chatId: input.chatId,
    role: "user",
    body: input.prompt,
  });
  return {
    goal: deriveGen2ChatGoal([
      ...messages,
      { role: "user", body: input.prompt },
    ]),
  };
}
