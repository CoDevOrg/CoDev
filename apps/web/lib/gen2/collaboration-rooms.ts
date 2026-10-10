import "server-only";

import {
  collaborationServerMessageSchema,
  type CollaborationServerMessage,
} from "@codev/contracts";
import type Redis from "ioredis";
import { collaborationContext } from "./collaboration-context";

import { listGen2LiveMemberIds } from "./collaboration-access";
import { Gen2AccessError } from "./errors";
import { withDatabaseOperation } from "../platform/database-operation";
import { sendSerialized, type Connection } from "./collaboration-connection";
import {
  REPLAY_LIMIT,
  STREAM_MAX_LENGTH,
  getInstanceId,
  redisClient,
  streamKey,
} from "./collaboration-redis";

export type StreamEvent = Extract<
  CollaborationServerMessage,
  { type: "update" | "awareness" | "reconciled" | "conflict" | "event" }
>;

/** Internal stream entries that never reach a browser. */
const PRESENCE_SYNC = "presence.sync";

export interface LocalRoom {
  connections: Set<Connection>;
  cursor: string;
  reader: Redis;
  polling: boolean;
  /** Another instance changed presence; re-read and fan it out locally. */
  onPresenceSync?: (() => unknown) | undefined;
}

const localRooms = new Map<string, LocalRoom>();
function rooms() {
  return collaborationContext.getStore()?.rooms ?? localRooms;
}

/**
 * Delivers to this instance's sockets after revalidating every recipient's
 * membership in one query. Removed members are disconnected, never served.
 */
export async function broadcastLocal(
  workspaceId: string,
  message: CollaborationServerMessage,
  except?: Connection,
) {
  const room = rooms().get(workspaceId);
  if (!room) return;
  const recipients = [...room.connections].filter(
    (connection) => connection !== except && shouldReceive(connection, message),
  );
  if (!recipients.length) return;
  const payload = JSON.stringify(
    collaborationServerMessageSchema.parse(message),
  );
  const live = await withDatabaseOperation(() =>
    listGen2LiveMemberIds(
      workspaceId.replace(/^gen2:/, ""),
      recipients.map((connection) => connection.user.id),
    ),
  );
  for (const connection of recipients) {
    if (!live.has(connection.user.id)) {
      room.connections.delete(connection);
      connection.socket.close(1008, "Workspace access unavailable.");
    } else if (room.connections.has(connection)) {
      sendSerialized(connection, payload);
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

type ParsedEntry = {
  id: string;
  instance: string | null;
  message: StreamEvent | typeof PRESENCE_SYNC;
};

function parseEntry(id: string, fields: unknown[]): ParsedEntry | null {
  const field = (name: string) => {
    const index = fields.indexOf(name);
    const value = index >= 0 ? fields[index + 1] : null;
    return typeof value === "string" ? value : null;
  };
  const raw = field("payload");
  if (!raw) return null;
  const instance = field("instance");
  try {
    const json = JSON.parse(raw);
    if (json?.type === PRESENCE_SYNC)
      return { id, instance, message: PRESENCE_SYNC };
    const parsed = collaborationServerMessageSchema.parse(json);
    if (
      parsed.type !== "update" &&
      parsed.type !== "awareness" &&
      parsed.type !== "reconciled" &&
      parsed.type !== "conflict" &&
      parsed.type !== "event"
    )
      return null;
    const message = "streamId" in parsed ? { ...parsed, streamId: id } : parsed;
    return { id, instance, message };
  } catch {
    // Ignore malformed stream entries; clients must never receive them.
    return null;
  }
}

function parseStreamResult(result: unknown) {
  if (!Array.isArray(result)) return [];
  return result.flatMap((stream) =>
    Array.isArray(stream) && Array.isArray(stream[1])
      ? stream[1].flatMap((entry: unknown) =>
          Array.isArray(entry) &&
          typeof entry[0] === "string" &&
          Array.isArray(entry[1])
            ? (parseEntry(entry[0], entry[1]) ?? [])
            : [],
        )
      : [],
  );
}

export async function startRoom(
  workspaceId: string,
  options: { onPresenceSync?: () => unknown } = {},
) {
  const existing = rooms().get(workspaceId);
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
    onPresenceSync: options.onPresenceSync,
  };
  rooms().set(workspaceId, room);
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
        if (event.instance === getInstanceId()) continue;
        if (event.message === PRESENCE_SYNC) await room.onPresenceSync?.();
        else await broadcastLocal(workspaceId, event.message);
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
    rooms().delete(workspaceId);
  }
}

async function appendToStream(workspaceId: string, payload: unknown) {
  const streamId = await redisClient().xadd(
    streamKey(workspaceId),
    "MAXLEN",
    "~",
    STREAM_MAX_LENGTH,
    "*",
    "instance",
    getInstanceId(),
    "payload",
    JSON.stringify(payload),
  );
  return streamId ?? "0-0";
}

export async function publish(workspaceId: string, message: StreamEvent) {
  const streamId = await appendToStream(workspaceId, message);
  await broadcastLocal(workspaceId, message);
  return streamId;
}

/**
 * Publishes a message that carries its own stream id. Other instances read
 * the id from the stream entry; local sockets get it from the append.
 */
export async function publishStamped(
  workspaceId: string,
  build: (streamId: string) => StreamEvent,
  except?: Connection,
) {
  const streamId = await appendToStream(workspaceId, build("pending"));
  await broadcastLocal(workspaceId, build(streamId), except);
  return streamId;
}

/** Tells other instances to re-read presence; nothing is sent to browsers. */
export async function signalPresenceSync(workspaceId: string) {
  await appendToStream(workspaceId, { type: PRESENCE_SYNC });
}

export async function replay(
  workspaceId: string,
  connection: Connection,
  resumeFrom: string,
  path: string,
) {
  const live = await listGen2LiveMemberIds(workspaceId.replace(/^gen2:/, ""), [
    connection.user.id,
  ]);
  if (!live.has(connection.user.id)) throw new Gen2AccessError();
  const entries = await redisClient().xrange(
    streamKey(workspaceId),
    `(${resumeFrom}`,
    "+",
    "COUNT",
    REPLAY_LIMIT,
  );
  for (const event of parseStreamResult([[streamKey(workspaceId), entries]])) {
    const message = event.message;
    if (
      message !== PRESENCE_SYNC &&
      "path" in message &&
      message.path === path &&
      (!("worktreeId" in message) ||
        message.worktreeId === connection.worktreeId)
    )
      sendSerialized(connection, JSON.stringify(message));
  }
}
