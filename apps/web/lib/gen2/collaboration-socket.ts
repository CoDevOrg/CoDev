import "server-only";

import { randomUUID } from "node:crypto";

import {
  collaborationClientMessageSchema,
  presenceCursorSchema,
  type CollaborationUser,
} from "@codev/contracts";
import type { RawData, WebSocket } from "ws";
import {
  applyAwarenessUpdate,
  Awareness,
  encodeAwarenessUpdate,
} from "y-protocols/awareness";
import * as Y from "yjs";

import {
  decodeBase64,
  docFromUpdate,
  encodeBase64,
  encodedDocument,
} from "../collaboration/yjs-document";
import { logEvent } from "../platform/observability";
import { send, sendError, type Connection } from "./collaboration-connection";
import {
  HEARTBEAT_INTERVAL_MS,
  INSTANCE_ID,
  MAX_SOCKET_PAYLOAD_BYTES,
  STREAM_MAX_LENGTH,
  redisClient,
  streamKey,
  withDocumentLock,
} from "./collaboration-redis";
import {
  broadcastLocal,
  closeRoomIfEmpty,
  publish,
  replay,
  startRoom,
} from "./collaboration-rooms";
import { refreshPresence, removePresence } from "./collaboration-presence";
import {
  initializeGen2Document,
  loadGen2Document,
  reconcileGen2Document,
  saveGen2Document,
} from "./collaboration-documents";
import { gen2CollaborationRoom } from "./collaboration-events";

export const gen2CollaborationSocketMaxPayload = MAX_SOCKET_PAYLOAD_BYTES;

function roomConnection(
  socket: WebSocket,
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
    resumeFrom: null,
    replayedPaths: new Set(),
    alive: true,
    canEdit,
  };
}

async function subscribe(
  workspaceId: string,
  connection: Connection,
  path: string,
  stateVector?: string,
) {
  if (!connection.worktreeId) {
    sendError(connection, "not_joined", "Join a worktree first.", false, path);
    return;
  }
  const roomKey = gen2CollaborationRoom(workspaceId);
  const result = await withDocumentLock(
    roomKey,
    connection.worktreeId,
    path,
    async () => {
      const snapshot =
        (await loadGen2Document(workspaceId, connection.worktreeId!, path)) ??
        (await initializeGen2Document(
          workspaceId,
          connection.user.id,
          connection.worktreeId!,
          path,
        ));
      return reconcileGen2Document(workspaceId, connection.user.id, snapshot);
    },
  );
  connection.subscriptions.add(path);
  connection.activePath = path;
  if (result.event?.type === "reconciled") {
    await publish(roomKey, {
      type: "reconciled",
      worktreeId: connection.worktreeId,
      path,
      revision: result.event.revision,
      source: "filesystem",
      update: result.event.update,
    });
  } else if (result.event?.type === "conflict") {
    await publish(roomKey, {
      type: "conflict",
      worktreeId: connection.worktreeId,
      path,
      snapshotRevision: result.event.snapshotRevision,
      filesystemRevision: result.event.filesystemRevision,
      message:
        "The shared document and workspace file both changed. Neither version was overwritten.",
    });
  }
  if (connection.resumeFrom && !connection.replayedPaths.has(path)) {
    connection.replayedPaths.add(path);
    await replay(roomKey, connection, connection.resumeFrom, path);
  }
  const doc = docFromUpdate(result.snapshot.update);
  const update = stateVector
    ? Y.encodeStateAsUpdate(doc, decodeBase64(stateVector))
    : Y.encodeStateAsUpdate(doc);
  send(connection, {
    type: "sync",
    path,
    update: encodeBase64(update),
    stateVector: encodeBase64(Y.encodeStateVector(doc)),
    revision: result.snapshot.revision,
  });
  await refreshPresence(roomKey, connection);
}

async function applyUpdate(
  workspaceId: string,
  connection: Connection,
  path: string,
  update: string,
) {
  if (!connection.worktreeId) {
    sendError(connection, "not_joined", "Join a worktree first.", false, path);
    return;
  }
  const roomKey = gen2CollaborationRoom(workspaceId);
  const outcome = await withDocumentLock(
    roomKey,
    connection.worktreeId,
    path,
    async () => {
      const loaded = await loadGen2Document(
        workspaceId,
        connection.worktreeId!,
        path,
      );
      if (!loaded) throw new Error("The collaborative document was not found.");
      const reconciled = await reconcileGen2Document(
        workspaceId,
        connection.user.id,
        loaded,
      );
      if (reconciled.event?.type === "conflict") {
        return { conflict: reconciled.event, reconciled: null };
      }
      const doc = docFromUpdate(reconciled.snapshot.update);
      Y.applyUpdate(doc, decodeBase64(update), "client");
      await saveGen2Document({
        ...reconciled.snapshot,
        ...encodedDocument(doc),
      });
      return {
        conflict: null,
        reconciled:
          reconciled.event?.type === "reconciled" ? reconciled.event : null,
      };
    },
  );
  if (outcome.conflict) {
    await publish(roomKey, {
      type: "conflict",
      worktreeId: connection.worktreeId,
      path,
      snapshotRevision: outcome.conflict.snapshotRevision,
      filesystemRevision: outcome.conflict.filesystemRevision,
      message:
        "A collaborative edit arrived after the file changed on the workspace. Neither version was overwritten.",
    });
    return;
  }
  if (outcome.reconciled) {
    await publish(roomKey, {
      type: "reconciled",
      worktreeId: connection.worktreeId,
      path,
      revision: outcome.reconciled.revision,
      source: "filesystem",
      update: outcome.reconciled.update,
    });
  }
  const streamId = await redisClient().xadd(
    streamKey(roomKey),
    "MAXLEN",
    "~",
    STREAM_MAX_LENGTH,
    "*",
    "instance",
    INSTANCE_ID,
    "payload",
    JSON.stringify({
      type: "update",
      worktreeId: connection.worktreeId,
      path,
      update,
      revision:
        (await loadGen2Document(workspaceId, connection.worktreeId!, path))
          ?.revision ?? "pending",
      actorId: connection.user.id,
      streamId: "pending",
    }),
  );
  broadcastLocal(
    roomKey,
    {
      type: "update",
      worktreeId: connection.worktreeId,
      path,
      update,
      revision:
        (await loadGen2Document(workspaceId, connection.worktreeId!, path))
          ?.revision ?? "pending",
      actorId: connection.user.id,
      streamId: streamId ?? "0-0",
    },
    connection,
  );
}

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

async function publishAwareness(
  workspaceId: string,
  connection: Connection,
  path: string,
  update: string,
) {
  if (!connection.worktreeId || !connection.subscriptions.has(path)) {
    sendError(
      connection,
      "not_subscribed",
      "Subscribe before sharing your cursor.",
      false,
      path,
    );
    return;
  }
  const roomKey = gen2CollaborationRoom(workspaceId);
  connection.activePath = path;
  const sanitized = sanitizeAwareness(update, connection.user);
  const streamId = await redisClient().xadd(
    streamKey(roomKey),
    "MAXLEN",
    "~",
    STREAM_MAX_LENGTH,
    "*",
    "instance",
    INSTANCE_ID,
    "payload",
    JSON.stringify({
      type: "awareness",
      worktreeId: connection.worktreeId,
      path,
      update: sanitized.update,
      actorId: connection.user.id,
      connectionId: connection.id,
      streamId: "pending",
    }),
  );
  broadcastLocal(
    roomKey,
    {
      type: "awareness",
      worktreeId: connection.worktreeId,
      path,
      update: sanitized.update,
      actorId: connection.user.id,
      connectionId: connection.id,
      streamId: streamId ?? "0-0",
    },
    connection,
  );
  if (sanitized.cursor) connection.cursor = sanitized.cursor;
  await refreshPresence(roomKey, connection);
}

async function handleMessage(
  workspaceId: string,
  connection: Connection,
  data: RawData,
  isBinary: boolean,
) {
  const byteLength = Array.isArray(data)
    ? data.reduce((total, part) => total + part.byteLength, 0)
    : data.byteLength;
  if (isBinary || byteLength > MAX_SOCKET_PAYLOAD_BYTES) {
    sendError(
      connection,
      "payload_too_large",
      "Collaboration messages must be JSON under 128 KiB.",
      false,
    );
    return;
  }
  let message;
  try {
    message = collaborationClientMessageSchema.parse(
      JSON.parse(
        Array.isArray(data) ? Buffer.concat(data).toString() : data.toString(),
      ),
    );
  } catch {
    sendError(
      connection,
      "invalid_message",
      "Invalid collaboration message.",
      false,
    );
    return;
  }
  try {
    if (message.type === "join") {
      connection.worktreeId = message.worktreeId ?? "main";
      connection.joined = true;
      connection.resumeFrom = message.resumeFrom ?? null;
      const roomKey = gen2CollaborationRoom(workspaceId);
      const latest = await redisClient().xrevrange(
        streamKey(roomKey),
        "+",
        "-",
        "COUNT",
        1,
      );
      send(connection, {
        type: "welcome",
        connectionId: connection.id,
        user: connection.user,
        heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
        streamId: latest[0]?.[0] ?? "0-0",
      });
      await refreshPresence(roomKey, connection);
      return;
    }
    if (!connection.joined) {
      sendError(connection, "not_joined", "Join the workspace first.", false);
      return;
    }
    if (message.type === "subscribe")
      await subscribe(
        workspaceId,
        connection,
        message.path,
        message.stateVector,
      );
    else if (message.type === "update") {
      if (!connection.canEdit) {
        sendError(
          connection,
          "forbidden",
          "Edit permission is required to change workspace files.",
          false,
          message.path,
        );
        return;
      }
      if (!connection.subscriptions.has(message.path)) {
        sendError(
          connection,
          "not_subscribed",
          "Subscribe before editing this file.",
          false,
          message.path,
        );
        return;
      }
      await applyUpdate(workspaceId, connection, message.path, message.update);
    } else if (message.type === "awareness")
      await publishAwareness(
        workspaceId,
        connection,
        message.path,
        message.update,
      );
    else {
      connection.alive = true;
      await refreshPresence(gen2CollaborationRoom(workspaceId), connection);
    }
  } catch (error) {
    logEvent("error", "gen2.collaboration.socket_operation_failed", {
      workspaceId,
      worktreeId: connection.worktreeId,
      operation: message.type,
      path: "path" in message ? message.path : null,
      detail: error instanceof Error ? error.message : "unknown",
    });
    sendError(
      connection,
      "internal_error",
      "The collaboration service could not complete the operation.",
      true,
      "path" in message ? message.path : undefined,
    );
  }
}

export async function handleGen2CollaborationSocket(
  workspaceId: string,
  socket: WebSocket,
  user: CollaborationUser,
  options: { canEdit: boolean },
) {
  const roomKey = gen2CollaborationRoom(workspaceId);
  const room = await startRoom(roomKey);
  const connection = roomConnection(socket, user, options.canEdit);
  room.connections.add(connection);
  const heartbeat = setInterval(() => {
    if (!connection.alive) return socket.terminate();
    connection.alive = false;
    socket.ping();
    void refreshPresence(roomKey, connection);
  }, HEARTBEAT_INTERVAL_MS);
  heartbeat.unref();
  socket.on("pong", () => {
    connection.alive = true;
  });
  socket.on("message", (data, isBinary) => {
    void handleMessage(workspaceId, connection, data, isBinary);
  });
  socket.once("close", () => {
    clearInterval(heartbeat);
    room.connections.delete(connection);
    void removePresence(roomKey, connection);
    closeRoomIfEmpty(roomKey, room);
  });
  socket.once("error", () => {
    connection.alive = false;
  });
}
