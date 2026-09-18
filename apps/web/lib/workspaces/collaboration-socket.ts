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

import { readSandboxFile, writeSandboxFile } from "@/lib/runtime/orchestrator";
import { appendPresenceEvent } from "@/lib/workspaces/presence-events";

import { send, sendError, type Connection } from "./collaboration-connection";
import {
  decodeBase64,
  docFromUpdate,
  encodeBase64,
  encodedDocument,
  initializeSnapshot,
  loadSnapshot,
  reconcileSnapshot,
  resolveWorktree,
  sandboxWorktreeScope,
  saveSnapshot,
} from "./collaboration-documents";
import { refreshPresence, removePresence } from "./collaboration-presence";
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

export const collaborationSocketMaxPayload = MAX_SOCKET_PAYLOAD_BYTES;

async function subscribe(
  workspaceId: string,
  connection: Connection,
  path: string,
  stateVector?: string,
) {
  if (!connection.worktreeId) {
    sendError(
      connection,
      "not_joined",
      "Join the workspace first.",
      false,
      path,
    );
    return;
  }

  const previousPath = connection.activePath;

  const result = await withDocumentLock(
    workspaceId,
    connection.worktreeId,
    path,
    async () => {
      const loaded =
        (await loadSnapshot(connection.worktreeId!, path)) ??
        (await initializeSnapshot(workspaceId, connection.worktreeId!, path));
      return reconcileSnapshot(workspaceId, loaded);
    },
  );
  connection.subscriptions.add(path);
  connection.activePath = path;
  if (result.event?.type === "reconciled") {
    await publish(workspaceId, result.event);
  }
  if (connection.resumeFrom && !connection.replayedPaths.has(path)) {
    connection.replayedPaths.add(path);
    await replay(workspaceId, connection, connection.resumeFrom, path);
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
  if (result.event?.type === "conflict") {
    await publish(workspaceId, result.event);
  }
  await refreshPresence(workspaceId, connection);
  if (previousPath !== path) {
    await appendPresenceEvent({
      workspaceId,
      type: "presence.active_file.changed",
      data: {
        userId: connection.user.id,
        path,
        previousPath,
      },
    });
  }
}

async function applyDocumentUpdate(
  workspaceId: string,
  connection: Connection,
  path: string,
  update: string,
) {
  if (!connection.worktreeId || !connection.subscriptions.has(path)) {
    sendError(
      connection,
      connection.worktreeId ? "not_subscribed" : "not_joined",
      "Subscribe to the document before updating it.",
      false,
      path,
    );
    return;
  }

  const outcome = await withDocumentLock(
    workspaceId,
    connection.worktreeId,
    path,
    async () => {
      const loaded = await loadSnapshot(connection.worktreeId!, path);
      if (!loaded) throw new Error("The collaboration snapshot was not found.");
      const reconciled = await reconcileSnapshot(workspaceId, loaded);
      if (reconciled.event?.type === "reconciled") {
        await publish(workspaceId, reconciled.event);
      }

      const doc = docFromUpdate(reconciled.snapshot.update);
      Y.applyUpdate(doc, decodeBase64(update), "client");
      const contents = doc.getText("content").toString();
      const sandboxWorktreeId = await sandboxWorktreeScope(
        connection.worktreeId!,
      );
      if (reconciled.event) {
        const encoded = encodedDocument(doc);
        const filesystemRevision =
          reconciled.event.type === "conflict"
            ? reconciled.event.filesystemRevision
            : (reconciled.snapshot.filesystemRevision ??
              reconciled.snapshot.revision);
        await saveSnapshot(
          {
            ...reconciled.snapshot,
            ...encoded,
            hasConflict: true,
            conflictFilesystemRevision: filesystemRevision,
          },
          filesystemRevision,
        );
        return {
          event: {
            type: "conflict" as const,
            worktreeId: connection.worktreeId!,
            path,
            snapshotRevision: loaded.revision,
            filesystemRevision,
            message:
              "A collaborative edit arrived concurrently with a sandbox file change. Neither version was overwritten.",
          },
          updateEvent: null,
        };
      }
      try {
        const written = await writeSandboxFile(workspaceId, {
          path,
          contents,
          expectedRevision:
            reconciled.snapshot.filesystemRevision ??
            reconciled.snapshot.revision,
          ...(sandboxWorktreeId ? { worktreeId: sandboxWorktreeId } : {}),
        });
        const encoded = encodedDocument(doc);
        await saveSnapshot({
          ...reconciled.snapshot,
          ...encoded,
          revision: written.revision,
          filesystemRevision: written.revision,
          filesystemContents: contents,
          hasConflict: false,
          conflictFilesystemRevision: null,
        });
        return {
          event: null,
          updateEvent: {
            type: "update" as const,
            worktreeId: connection.worktreeId!,
            path,
            update,
            revision: written.revision,
            actorId: connection.user.id,
            streamId: "pending",
          },
        };
      } catch {
        const latest = await readSandboxFile(
          workspaceId,
          path,
          sandboxWorktreeId,
        );
        const encoded = encodedDocument(doc);
        await saveSnapshot(
          {
            ...reconciled.snapshot,
            ...encoded,
          },
          latest.revision,
        );
        return {
          event: {
            type: "conflict" as const,
            worktreeId: connection.worktreeId!,
            path,
            snapshotRevision: reconciled.snapshot.revision,
            filesystemRevision: latest.revision,
            message:
              "The sandbox file changed while the collaborative update was being saved. Neither version was overwritten.",
          },
          updateEvent: null,
        };
      }
    },
  );

  if (outcome.event) {
    await publish(workspaceId, outcome.event);
    return;
  }
  if (outcome.updateEvent) {
    const streamId = await redisClient().xadd(
      streamKey(workspaceId),
      "MAXLEN",
      "~",
      STREAM_MAX_LENGTH,
      "*",
      "instance",
      INSTANCE_ID,
      "payload",
      JSON.stringify(outcome.updateEvent),
    );
    broadcastLocal(workspaceId, {
      ...outcome.updateEvent,
      streamId: streamId ?? "0-0",
    });
  }
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
    if (state) {
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
  if (!connection.subscriptions.has(path)) {
    sendError(
      connection,
      "not_subscribed",
      "Subscribe before publishing awareness.",
      false,
      path,
    );
    return;
  }
  connection.activePath = path;
  const sanitized = sanitizeAwareness(update, connection.user);
  const cleanUpdate = sanitized.update;
  const event = {
    type: "awareness" as const,
    worktreeId: connection.worktreeId!,
    path,
    update: cleanUpdate,
    actorId: connection.user.id,
    connectionId: connection.id,
    streamId: "pending",
  };
  const streamId = await redisClient().xadd(
    streamKey(workspaceId),
    "MAXLEN",
    "~",
    STREAM_MAX_LENGTH,
    "*",
    "instance",
    INSTANCE_ID,
    "payload",
    JSON.stringify(event),
  );
  broadcastLocal(
    workspaceId,
    { ...event, streamId: streamId ?? "0-0" },
    connection,
  );
  await refreshPresence(workspaceId, connection);
  if (
    sanitized.cursor &&
    (connection.cursor?.anchor !== sanitized.cursor.anchor ||
      connection.cursor?.head !== sanitized.cursor.head)
  ) {
    connection.cursor = sanitized.cursor;
    await appendPresenceEvent({
      workspaceId,
      type: "presence.cursor.changed",
      data: {
        userId: connection.user.id,
        path,
        cursor: sanitized.cursor,
      },
    });
  }
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
      const worktreeId = await resolveWorktree(workspaceId, message.worktreeId);
      if (!worktreeId) {
        sendError(connection, "not_found", "Active worktree not found.", false);
        return;
      }
      connection.joined = true;
      connection.worktreeId = worktreeId;
      const room = await startRoom(workspaceId);
      const latest = await redisClient().xrevrange(
        streamKey(workspaceId),
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
        streamId: latest[0]?.[0] ?? room.cursor,
      });
      connection.resumeFrom = message.resumeFrom ?? null;
      await refreshPresence(workspaceId, connection);
      await appendPresenceEvent({
        workspaceId,
        type: "presence.joined",
        data: {
          userId: connection.user.id,
          worktreeId,
          activePath: connection.activePath,
          cursor: connection.cursor,
        },
      });
      return;
    }
    if (!connection.joined) {
      sendError(connection, "not_joined", "Join the workspace first.", false);
      return;
    }
    if (message.type === "subscribe") {
      await subscribe(
        workspaceId,
        connection,
        message.path,
        message.stateVector,
      );
    } else if (message.type === "update") {
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
      await applyDocumentUpdate(
        workspaceId,
        connection,
        message.path,
        message.update,
      );
    } else if (message.type === "awareness") {
      await publishAwareness(
        workspaceId,
        connection,
        message.path,
        message.update,
      );
    } else {
      connection.alive = true;
      await refreshPresence(workspaceId, connection);
    }
  } catch {
    sendError(
      connection,
      "internal_error",
      "The collaboration service could not complete the operation.",
      true,
      "path" in message ? message.path : undefined,
    );
  }
}

export async function handleCollaborationSocket(
  workspaceId: string,
  socket: WebSocket,
  user: CollaborationUser,
  options: { canEdit: boolean },
) {
  const room = await startRoom(workspaceId);
  const connection: Connection = {
    id: randomUUID(),
    socket,
    user,
    joined: false,
    worktreeId: null,
    subscriptions: new Set(),
    activePath: null,
    cursor: null,
    resumeFrom: null,
    replayedPaths: new Set(),
    alive: true,
    canEdit: options.canEdit,
  };
  room.connections.add(connection);

  const heartbeat = setInterval(() => {
    if (!connection.alive) {
      socket.terminate();
      return;
    }
    connection.alive = false;
    socket.ping();
    void refreshPresence(workspaceId, connection);
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
    if (connection.joined) {
      void appendPresenceEvent({
        workspaceId,
        type: "presence.left",
        data: {
          userId: connection.user.id,
          worktreeId: connection.worktreeId,
          activePath: connection.activePath,
          cursor: connection.cursor,
          reason: "disconnect",
        },
      }).catch(() => undefined);
    }
    void removePresence(workspaceId, connection);
    closeRoomIfEmpty(workspaceId, room);
  });
  socket.once("error", () => {
    connection.alive = false;
  });
}
