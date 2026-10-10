import "server-only";

import { randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { withDatabaseOperation } from "../platform/database-operation";
import {
  collaborationContext,
  withGen2CollaborationContext,
} from "./collaboration-context";

import type { CollaborationUser } from "@codev/contracts";
import type { ServerWebSocket, WebSocketMessage } from "../platform/websocket";

import type { Connection } from "./collaboration-connection";
import {
  HEARTBEAT_INTERVAL_MS,
  MAX_SOCKET_PAYLOAD_BYTES,
} from "./collaboration-redis";
import { closeRoomIfEmpty, startRoom } from "./collaboration-rooms";
import {
  broadcastPresence,
  refreshPresence,
  removePresence,
} from "./collaboration-presence";
import { handleMessage } from "./collaboration-messages";
import { flushAutosaves } from "./collaboration-autosave";
import { gen2CollaborationRoom } from "./collaboration-events";

export const gen2CollaborationSocketMaxPayload = MAX_SOCKET_PAYLOAD_BYTES;

function roomConnection(
  socket: ServerWebSocket,
  user: CollaborationUser,
  canEdit: boolean,
): Connection {
  return {
    id: randomUUID(),
    socket,
    user,
    joined: false,
    // Superset's host worktree ID is selected at join time. The common room
    // transport uses it solely to filter per-document fan-out.
    worktreeId: null,
    subscriptions: new Set(),
    activePath: null,
    cursor: null,
    view: null,
    chatId: null,
    away: false,
    lastTypingAt: 0,
    resumeFrom: null,
    replayedPaths: new Set(),
    lastSeenAt: Date.now(),
    canEdit,
    pendingUpdates: new Map(),
    autosaves: new Map(),
  };
}

export function handleGen2CollaborationSocket(
  workspaceId: string,
  socket: ServerWebSocket,
  user: CollaborationUser,
  options: { canEdit: boolean },
) {
  return withGen2CollaborationContext(() =>
    connectCollaborationSocket(workspaceId, socket, user, options),
  );
}

async function connectCollaborationSocket(
  workspaceId: string,
  socket: ServerWebSocket,
  user: CollaborationUser,
  options: { canEdit: boolean },
) {
  const inContext = AsyncLocalStorage.snapshot();
  const roomKey = gen2CollaborationRoom(workspaceId);
  const connection = roomConnection(socket, user, options.canEdit);
  let room: Awaited<ReturnType<typeof startRoom>> | null = null;
  let closed = false;
  const pendingMessages: WebSocketMessage[] = [];
  const heartbeat = setInterval(() => {
    if (Date.now() - connection.lastSeenAt > HEARTBEAT_INTERVAL_MS * 2) {
      socket.terminate();
      return;
    }
    if (room) void refreshPresence(roomKey, connection);
  }, HEARTBEAT_INTERVAL_MS);
  socket.onMessage((message) =>
    inContext(() => {
      connection.lastSeenAt = Date.now();
      if (!room) {
        if (pendingMessages.length >= 16) {
          socket.close(1013, "Collaboration is still starting.");
          return;
        }
        pendingMessages.push(message);
        return;
      }
      return withDatabaseOperation(() =>
        handleMessage(workspaceId, connection, message),
      );
    }),
  );
  socket.onceClose(() =>
    inContext(() => {
      closed = true;
      clearInterval(heartbeat);
      if (room) {
        room.connections.delete(connection);
        // Pending file writes go first; they need this socket's Redis client.
        void flushAutosaves(connection)
          .then(() => removePresence(roomKey, connection))
          .finally(() => collaborationContext.getStore()?.redis?.disconnect());
        closeRoomIfEmpty(roomKey, room);
      }
    }),
  );
  socket.onceError(() => {
    connection.lastSeenAt = 0;
  });

  room = await startRoom(roomKey, {
    onPresenceSync: () => broadcastPresence(roomKey),
  });
  if (closed) {
    closeRoomIfEmpty(roomKey, room);
    return;
  }
  room.connections.add(connection);
  for (const message of pendingMessages) {
    await withDatabaseOperation(() =>
      handleMessage(workspaceId, connection, message),
    );
  }
}
