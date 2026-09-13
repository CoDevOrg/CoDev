import "server-only";

import { readServerEnvironment } from "@codev/config";
import Redis from "ioredis";

import {
  importedConversationMessageSchema,
  type ImportedConversationMessage,
} from "@codev/contracts";

// Room transcripts are append-only and small, so a short stream is plenty:
// the SSE route backfills missed history from Postgres by sequence, and Redis
// only has to carry the live tail between a write and its subscribers.
const STREAM_MAX_LENGTH = 500;
const READ_COUNT = 100;

let redis: Redis | undefined;

function redisClient(): Redis | null {
  const url = readServerEnvironment().REDIS_URL;
  if (!url) return null;
  if (!redis) {
    redis = new Redis(url, {
      lazyConnect: true,
      maxRetriesPerRequest: 2,
      enableReadyCheck: true,
    });
  }
  return redis;
}

function streamKey(roomId: string) {
  return `codev:room:${roomId}:events`;
}

/**
 * Fans a freshly persisted room message out to every open SSE subscriber.
 * Best-effort by design: realtime delivery is an enhancement layered on top
 * of the durable Postgres transcript, so a Redis hiccup must never fail the
 * write that already committed. Subscribers still catch up via polling.
 */
export async function publishRoomMessages(
  roomId: string,
  messages: ImportedConversationMessage[],
): Promise<void> {
  if (!messages.length) return;
  const client = redisClient();
  if (!client) return;
  try {
    if (client.status === "wait") await client.connect();
    for (const message of messages) {
      await client.xadd(
        streamKey(roomId),
        "MAXLEN",
        "~",
        STREAM_MAX_LENGTH,
        "*",
        "payload",
        JSON.stringify(message),
      );
    }
  } catch {
    // Swallowed on purpose — see the doc comment above.
  }
}

/**
 * A dedicated blocking connection for one SSE subscriber. `XREAD BLOCK` holds
 * the socket, so it must never share the shared command client.
 */
export function createRoomReader(): Redis | null {
  return redisClient()?.duplicate() ?? null;
}

/**
 * The id of the most recent stream entry, used as the starting cursor so a
 * subscriber only receives messages published after it connected. `"$"` (the
 * XREAD "new entries only" sentinel) is returned when the stream is empty.
 */
export async function latestRoomStreamId(roomId: string): Promise<string> {
  const client = redisClient();
  if (!client) return "$";
  if (client.status === "wait") await client.connect();
  const latest = await client.xrevrange(
    streamKey(roomId),
    "+",
    "-",
    "COUNT",
    1,
  );
  return latest[0]?.[0] ?? "$";
}

export type RoomStreamEntry = {
  id: string;
  message: ImportedConversationMessage;
};

function parseRoomStreamResult(result: unknown): RoomStreamEntry[] {
  if (!Array.isArray(result)) return [];
  const entries: RoomStreamEntry[] = [];
  for (const stream of result) {
    if (!Array.isArray(stream) || !Array.isArray(stream[1])) continue;
    for (const entry of stream[1]) {
      if (!Array.isArray(entry) || typeof entry[0] !== "string") continue;
      const fields = entry[1];
      if (!Array.isArray(fields)) continue;
      const payloadIndex = fields.indexOf("payload");
      if (payloadIndex < 0 || typeof fields[payloadIndex + 1] !== "string") {
        continue;
      }
      try {
        const parsed = importedConversationMessageSchema.safeParse(
          JSON.parse(fields[payloadIndex + 1]),
        );
        if (parsed.success)
          entries.push({ id: entry[0], message: parsed.data });
      } catch {
        // A malformed entry must never break the live feed for a subscriber.
      }
    }
  }
  return entries;
}

/**
 * Blocks up to `blockMs` for new messages on the room stream after `cursor`.
 * Returns an empty array on timeout so the caller can emit a heartbeat and
 * loop again.
 */
export async function readRoomMessages(
  reader: Redis,
  roomId: string,
  cursor: string,
  blockMs: number,
): Promise<RoomStreamEntry[]> {
  if (reader.status === "wait") await reader.connect();
  const result = await reader.call(
    "XREAD",
    "BLOCK",
    blockMs,
    "COUNT",
    READ_COUNT,
    "STREAMS",
    streamKey(roomId),
    cursor,
  );
  return parseRoomStreamResult(result);
}
