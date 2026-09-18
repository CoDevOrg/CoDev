import "server-only";

import { readServerEnvironment } from "@codev/config";
import {
  workspaceRealtimeEventSchema,
  type WorkspaceRealtimeEvent,
} from "@codev/contracts";
import Redis from "ioredis";

// This stream is a live invalidation channel, not durable history. The REST
// projections remain authoritative, so a short tail is enough to bridge the
// gap between a write and a connected browser.
const STREAM_MAX_LENGTH = 1_000;
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

function streamKey(workspaceId: string) {
  return `codev:workspace:${workspaceId}:realtime`;
}

/**
 * Publish a projection invalidation after its database write commits. Redis
 * is intentionally best-effort: losing realtime must never make a successful
 * workspace mutation fail, and clients already have a slower REST fallback.
 */
export async function publishWorkspaceRealtimeEvent(
  workspaceId: string,
  type: string,
  payload: Record<string, unknown> = {},
): Promise<void> {
  const client = redisClient();
  if (!client) return;

  try {
    const event = workspaceRealtimeEventSchema.parse({
      workspaceId,
      type,
      payload,
      createdAt: new Date().toISOString(),
    });
    if (client.status === "wait") await client.connect();
    await client.xadd(
      streamKey(workspaceId),
      "MAXLEN",
      "~",
      STREAM_MAX_LENGTH,
      "*",
      "payload",
      JSON.stringify(event),
    );
  } catch {
    // See the function comment: the database write is the source of truth.
  }
}

/** A dedicated blocking connection for one SSE subscriber. */
export function createWorkspaceRealtimeReader(): Redis | null {
  return redisClient()?.duplicate() ?? null;
}

/** Start at the current tail when a browser has no cursor to resume. */
export async function latestWorkspaceRealtimeStreamId(
  workspaceId: string,
): Promise<string> {
  const client = redisClient();
  if (!client) return "$";
  if (client.status === "wait") await client.connect();
  const latest = await client.xrevrange(
    streamKey(workspaceId),
    "+",
    "-",
    "COUNT",
    1,
  );
  return latest[0]?.[0] ?? "$";
}

export type WorkspaceRealtimeStreamEntry = {
  id: string;
  event: WorkspaceRealtimeEvent;
};

function parseStreamResult(result: unknown): WorkspaceRealtimeStreamEntry[] {
  if (!Array.isArray(result)) return [];
  const entries: WorkspaceRealtimeStreamEntry[] = [];
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
        const parsed = workspaceRealtimeEventSchema.safeParse(
          JSON.parse(fields[payloadIndex + 1]),
        );
        if (parsed.success) entries.push({ id: entry[0], event: parsed.data });
      } catch {
        // A malformed entry must not break the live feed for this subscriber.
      }
    }
  }
  return entries;
}

/** Block briefly for new invalidations, returning [] on a quiet heartbeat. */
export async function readWorkspaceRealtimeEvents(
  reader: Redis,
  workspaceId: string,
  cursor: string,
  blockMs: number,
): Promise<WorkspaceRealtimeStreamEntry[]> {
  if (reader.status === "wait") await reader.connect();
  const result = await reader.call(
    "XREAD",
    "BLOCK",
    blockMs,
    "COUNT",
    READ_COUNT,
    "STREAMS",
    streamKey(workspaceId),
    cursor,
  );
  return parseStreamResult(result);
}
