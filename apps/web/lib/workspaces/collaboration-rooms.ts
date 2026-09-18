import "server-only";

import {
  collaborationServerMessageSchema,
  type CollaborationServerMessage,
} from "@codev/contracts";
import type Redis from "ioredis";

import { send, type Connection } from "./collaboration-connection";
import {
  INSTANCE_ID,
  REPLAY_LIMIT,
  STREAM_MAX_LENGTH,
  redisClient,
  streamKey,
} from "./collaboration-redis";

export type StreamEvent = Extract<
  CollaborationServerMessage,
  { type: "update" | "awareness" | "reconciled" | "conflict" }
>;

export interface LocalRoom {
  connections: Set<Connection>;
  cursor: string;
  reader: Redis;
  polling: boolean;
}

const localRooms = new Map<string, LocalRoom>();

export function broadcastLocal(
  workspaceId: string,
  message: CollaborationServerMessage,
  except?: Connection,
) {
  const room = localRooms.get(workspaceId);
  if (!room) return;
  for (const connection of room.connections) {
    if (connection !== except && shouldReceive(connection, message)) {
      send(connection, message);
    }
  }
}

function shouldReceive(
  connection: Connection,
  message: CollaborationServerMessage,
) {
  return (
    !("path" in message) ||
    message.type === "error" ||
    (connection.subscriptions.has(message.path) &&
      (!("worktreeId" in message) ||
        connection.worktreeId === message.worktreeId))
  );
}

function parseStreamResult(result: unknown) {
  if (!Array.isArray(result)) return [];
  const events: Array<{
    id: string;
    instance: string | null;
    message: StreamEvent;
  }> = [];
  for (const stream of result) {
    if (!Array.isArray(stream) || !Array.isArray(stream[1])) continue;
    for (const entry of stream[1]) {
      if (!Array.isArray(entry) || typeof entry[0] !== "string") continue;
      const fields = entry[1];
      if (!Array.isArray(fields)) continue;
      const payloadIndex = fields.indexOf("payload");
      const instanceIndex = fields.indexOf("instance");
      if (payloadIndex < 0 || typeof fields[payloadIndex + 1] !== "string") {
        continue;
      }
      try {
        const parsed = collaborationServerMessageSchema.parse(
          JSON.parse(fields[payloadIndex + 1]),
        );
        if (
          parsed.type === "update" ||
          parsed.type === "awareness" ||
          parsed.type === "reconciled" ||
          parsed.type === "conflict"
        ) {
          const message =
            parsed.type === "update" || parsed.type === "awareness"
              ? { ...parsed, streamId: entry[0] }
              : parsed;
          events.push({
            id: entry[0],
            instance:
              instanceIndex >= 0 &&
              typeof fields[instanceIndex + 1] === "string"
                ? fields[instanceIndex + 1]
                : null,
            message,
          });
        }
      } catch {
        // Ignore malformed stream entries; clients must never receive them.
      }
    }
  }
  return events;
}

export async function startRoom(workspaceId: string) {
  const existing = localRooms.get(workspaceId);
  if (existing) return existing;

  const client = redisClient();
  if (client.status === "wait") await client.connect();
  const latest = await client.xrevrange(
    streamKey(workspaceId),
    "+",
    "-",
    "COUNT",
    1,
  );
  const room: LocalRoom = {
    connections: new Set(),
    cursor: latest[0]?.[0] ?? "0-0",
    reader: client.duplicate(),
    polling: true,
  };
  localRooms.set(workspaceId, room);
  void pollRoom(workspaceId, room);
  return room;
}

async function pollRoom(workspaceId: string, room: LocalRoom) {
  try {
    if (room.reader.status === "wait") await room.reader.connect();
    while (room.polling) {
      const result = await room.reader.call(
        "XREAD",
        "BLOCK",
        5_000,
        "COUNT",
        100,
        "STREAMS",
        streamKey(workspaceId),
        room.cursor,
      );
      for (const event of parseStreamResult(result)) {
        room.cursor = event.id;
        if (event.instance !== INSTANCE_ID) {
          broadcastLocal(workspaceId, event.message);
        }
      }
    }
  } catch {
    if (room.polling) {
      setTimeout(() => void pollRoom(workspaceId, room), 1_000).unref();
    }
  }
}

/**
 * The socket-close teardown, here rather than inline at the call site only
 * because `localRooms` is private to this module.
 */
export function closeRoomIfEmpty(workspaceId: string, room: LocalRoom) {
  if (room.connections.size === 0) {
    room.polling = false;
    void room.reader.quit();
    localRooms.delete(workspaceId);
  }
}

export async function publish(workspaceId: string, message: StreamEvent) {
  const client = redisClient();
  const streamId = await client.xadd(
    streamKey(workspaceId),
    "MAXLEN",
    "~",
    STREAM_MAX_LENGTH,
    "*",
    "instance",
    INSTANCE_ID,
    "payload",
    JSON.stringify(message),
  );
  broadcastLocal(workspaceId, message);
  return streamId ?? "0-0";
}

export async function replay(
  workspaceId: string,
  connection: Connection,
  resumeFrom: string,
  path: string,
) {
  const entries = await redisClient().xrange(
    streamKey(workspaceId),
    `(${resumeFrom}`,
    "+",
    "COUNT",
    REPLAY_LIMIT,
  );
  const events = parseStreamResult([[streamKey(workspaceId), entries]]);
  for (const event of events) {
    if (
      "path" in event.message &&
      event.message.path === path &&
      (!("worktreeId" in event.message) ||
        event.message.worktreeId === connection.worktreeId)
    )
      send(connection, event.message);
  }
}
