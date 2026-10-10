import "server-only";

import type {
  CollaborationClientMessage,
  Gen2WorkspaceView,
} from "@codev/contracts";

import type { Connection } from "./collaboration-connection";
import { publishStamped } from "./collaboration-rooms";
import { refreshPresence } from "./collaboration-presence";
import { gen2CollaborationRoom } from "./collaboration-events";

const TYPING_REPEAT_MS = 1_500;

type FocusMessage = Extract<CollaborationClientMessage, { type: "focus" }>;

/**
 * Records where a member is. Switching worktree drops document subscriptions,
 * because one socket follows one worktree at a time.
 */
export function switchWorktree(connection: Connection, worktreeId: string) {
  if (connection.worktreeId === worktreeId) return;
  connection.worktreeId = worktreeId;
  connection.subscriptions.clear();
  connection.replayedPaths.clear();
}

export async function applyFocus(
  workspaceId: string,
  connection: Connection,
  message: FocusMessage,
) {
  switchWorktree(connection, message.worktreeId);
  if (connection.activePath !== message.path) connection.cursor = null;
  connection.activePath = message.path;
  connection.view = message.view satisfies Gen2WorkspaceView;
  connection.chatId = message.chatId;
  connection.away = message.away;
  await refreshPresence(gen2CollaborationRoom(workspaceId), connection, {
    changed: true,
  });
}

/** Relays "is typing" to other members; viewers cannot send prompts. */
export async function relayTyping(
  workspaceId: string,
  connection: Connection,
  chatId: string,
) {
  const now = Date.now();
  if (!connection.canEdit || now - connection.lastTypingAt < TYPING_REPEAT_MS)
    return;
  connection.lastTypingAt = now;
  await publishStamped(
    gen2CollaborationRoom(workspaceId),
    (streamId) => ({
      type: "event",
      event: { kind: "typing", chatId, userId: connection.user.id },
      streamId,
      at: new Date(now).toISOString(),
    }),
    connection,
  );
}
