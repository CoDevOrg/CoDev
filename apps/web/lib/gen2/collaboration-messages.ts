import "server-only";

import {
  collaborationClientMessageSchema,
  type CollaborationClientMessage,
} from "@codev/contracts";

import type { WebSocketMessage } from "../platform/websocket";
import { logEvent } from "../platform/observability";
import { send, sendError, type Connection } from "./collaboration-connection";
import {
  HEARTBEAT_INTERVAL_MS,
  MAX_SOCKET_PAYLOAD_BYTES,
  redisClient,
  streamKey,
} from "./collaboration-redis";
import { refreshPresence } from "./collaboration-presence";
import { subscribe, unsubscribe } from "./collaboration-subscribe";
import { applyUpdate } from "./collaboration-update";
import { publishAwareness } from "./collaboration-awareness";
import { applyFocus, relayTyping, switchWorktree } from "./collaboration-focus";
import { requireGen2Member } from "./workspaces";
import { gen2CollaborationRoom } from "./collaboration-events";

function parseMessage(connection: Connection, socketMessage: WebSocketMessage) {
  const { data, isBinary } = socketMessage;
  if (
    isBinary ||
    data === null ||
    new TextEncoder().encode(data).byteLength > MAX_SOCKET_PAYLOAD_BYTES
  ) {
    sendError(
      connection,
      "payload_too_large",
      "Collaboration messages must be JSON under 128 KiB.",
      false,
    );
    return null;
  }
  try {
    return collaborationClientMessageSchema.parse(JSON.parse(data));
  } catch {
    sendError(
      connection,
      "invalid_message",
      "Invalid collaboration message.",
      false,
    );
    return null;
  }
}

async function join(
  workspaceId: string,
  connection: Connection,
  message: Extract<CollaborationClientMessage, { type: "join" }>,
) {
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
  await refreshPresence(roomKey, connection, { changed: true });
}

async function update(
  workspaceId: string,
  connection: Connection,
  message: Extract<CollaborationClientMessage, { type: "update" }>,
) {
  const membership = await requireGen2Member(workspaceId, connection.user.id);
  connection.canEdit = membership.role !== "viewer";
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
}

/**
 * An edit or cursor aimed at a worktree this socket has since left is stale.
 * Subscribe and focus instead move the socket: a newly mounted file pane can
 * subscribe before the shell reports its focus.
 */
function isStale(connection: Connection, message: CollaborationClientMessage) {
  return (
    (message.type === "update" ||
      message.type === "awareness" ||
      message.type === "unsubscribe") &&
    message.worktreeId !== undefined &&
    message.worktreeId !== connection.worktreeId
  );
}

async function dispatch(
  workspaceId: string,
  connection: Connection,
  message: CollaborationClientMessage,
) {
  if (message.type === "join") return join(workspaceId, connection, message);
  if (!connection.joined) {
    sendError(connection, "not_joined", "Join the workspace first.", false);
    return;
  }
  if (isStale(connection, message)) return;
  switch (message.type) {
    case "subscribe":
      if (message.worktreeId) switchWorktree(connection, message.worktreeId);
      return subscribe(
        workspaceId,
        connection,
        message.path,
        message.stateVector,
      );
    case "unsubscribe":
      return unsubscribe(workspaceId, connection, message.path);
    case "update":
      return update(workspaceId, connection, message);
    case "awareness":
      return publishAwareness(
        workspaceId,
        connection,
        message.path,
        message.update,
      );
    case "focus":
      return applyFocus(workspaceId, connection, message);
    case "typing":
      return relayTyping(workspaceId, connection, message.chatId);
    case "heartbeat":
      return refreshPresence(gen2CollaborationRoom(workspaceId), connection);
  }
}

export async function handleMessage(
  workspaceId: string,
  connection: Connection,
  socketMessage: WebSocketMessage,
) {
  const message = parseMessage(connection, socketMessage);
  if (!message) return;
  try {
    await dispatch(workspaceId, connection, message);
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
      "path" in message && message.path ? message.path : undefined,
    );
  }
}
