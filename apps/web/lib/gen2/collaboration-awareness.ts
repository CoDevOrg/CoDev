import "server-only";

import { presenceCursorSchema, type CollaborationUser } from "@codev/contracts";
import {
  applyAwarenessUpdate,
  Awareness,
  encodeAwarenessUpdate,
} from "y-protocols/awareness";
import * as Y from "yjs";

import { decodeBase64, encodeBase64 } from "../collaboration/yjs-document";
import type { Connection } from "./collaboration-connection";
import { publishStamped } from "./collaboration-rooms";
import { gen2CollaborationRoom } from "./collaboration-events";

/** Replaces any client-claimed identity with the server-known member. */
function sanitizeAwareness(update: string, user: CollaborationUser) {
  const awareness = new Awareness(new Y.Doc());
  let clientIds: number[] = [];
  let cursor: { anchor: number; head: number } | null = null;
  awareness.on(
    "update",
    (changes: { added: number[]; updated: number[]; removed: number[] }) => {
      clientIds = [
        ...changes.added,
        ...changes.updated,
        ...changes.removed,
      ].filter((clientId) => clientId !== awareness.clientID);
    },
  );
  applyAwarenessUpdate(awareness, decodeBase64(update), "client");
  for (const clientId of clientIds) {
    const state = awareness.states.get(clientId);
    if (!state) continue;
    const parsedCursor = presenceCursorSchema.safeParse(state.cursor);
    if (parsedCursor.success) cursor = parsedCursor.data;
    awareness.states.set(clientId, {
      ...state,
      user: {
        id: user.id,
        login: user.login,
        name: user.name,
        image: user.avatarUrl,
      },
    });
  }
  return {
    update: encodeBase64(encodeAwarenessUpdate(awareness, clientIds)),
    cursor,
  };
}

/**
 * Cursor moves travel as awareness only. Presence is rewritten on the next
 * heartbeat, so a keystroke never costs a presence fan-out.
 */
export async function publishAwareness(
  workspaceId: string,
  connection: Connection,
  path: string,
  update: string,
) {
  // A cursor can arrive before its subscription finishes. Presence is
  // ephemeral, so drop it quietly instead of showing members a protocol error.
  const worktreeId = connection.worktreeId;
  if (!worktreeId || !connection.subscriptions.has(path)) return;
  const sanitized = sanitizeAwareness(update, connection.user);
  await publishStamped(
    gen2CollaborationRoom(workspaceId),
    (streamId) => ({
      type: "awareness",
      worktreeId,
      path,
      update: sanitized.update,
      actorId: connection.user.id,
      connectionId: connection.id,
      streamId,
    }),
    connection,
  );
  connection.activePath = path;
  if (sanitized.cursor) connection.cursor = sanitized.cursor;
}
