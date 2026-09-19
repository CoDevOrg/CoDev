import "server-only";

import {
  collaborationPresenceEntrySchema,
  type CollaborationPresenceEntry,
  type CollaborationUser,
} from "@codev/contracts";

import { appendPresenceEvent } from "@/lib/workspaces/presence-events";

import type { Connection } from "./collaboration-connection";
import {
  PRESENCE_TTL_MS,
  presenceExpiryKey,
  presenceHashKey,
  redisClient,
} from "./collaboration-redis";
import { broadcastLocal } from "./collaboration-rooms";

/**
 * Returns the distinct people with an active collaboration connection. This
 * is intentionally separate from workspace membership: a member appears in
 * this list only while their realtime presence heartbeat is current.
 */
export async function listWorkspacePresence(workspaceId: string) {
  return (await listWorkspacePresenceEntries(workspaceId)).map(
    (entry) => entry.user,
  );
}

/**
 * Returns active collaboration identities with their redacted active file.
 * Callers must enforce workspace membership before exposing this state.
 */
export async function listWorkspacePresenceEntries(workspaceId: string) {
  try {
    const client = redisClient();
    if (client.status === "wait") await client.connect();
    const values = await client.hvals(presenceHashKey(workspaceId));
    const people = new Map<string, CollaborationPresenceEntry>();

    for (const value of values) {
      try {
        const parsed = collaborationPresenceEntrySchema.safeParse(
          JSON.parse(value),
        );
        if (!parsed.success) continue;
        const current = people.get(parsed.data.user.id);
        if (
          !current ||
          parsed.data.lastSeenAt.localeCompare(current.lastSeenAt) > 0
        ) {
          people.set(parsed.data.user.id, parsed.data);
        }
      } catch {
        // A stale or malformed presence record must not block the dashboard.
      }
    }

    return [...people.values()]
      .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt))
      .slice(0, 5);
  } catch {
    // Presence is an enhancement. An unavailable realtime service simply
    // leaves the preview in its neutral state.
    return [];
  }
}

/**
 * Orca's editor tabs use the same short-lived presence store as the realtime
 * collaboration socket. The stable per-user key keeps tab changes current
 * without exposing a connection token to the embedded client.
 */
export async function recordOrcaActiveFile(
  workspaceId: string,
  user: CollaborationUser,
  path: string,
) {
  let cursor: { anchor: number; head: number } | null = null;
  try {
    const raw = await redisClient().hget(
      presenceHashKey(workspaceId),
      `orca:${user.id}`,
    );
    const existing = raw
      ? collaborationPresenceEntrySchema.safeParse(JSON.parse(raw))
      : null;
    if (existing?.success && existing.data.path === path) {
      cursor = existing.data.cursor;
    }
  } catch {
    // The write below remains authoritative when a prior presence read fails.
  }
  return recordOrcaPresence(workspaceId, user, path, cursor, false);
}

/**
 * Stores the editor selection using the existing short-lived, authorized
 * presence record. Cursor offsets are document-relative and never expose a
 * connection credential to the embedded Orca client.
 */
export async function recordOrcaCursor(
  workspaceId: string,
  user: CollaborationUser,
  path: string,
  cursor: { anchor: number; head: number },
) {
  return recordOrcaPresence(workspaceId, user, path, cursor, true);
}

async function recordOrcaPresence(
  workspaceId: string,
  user: CollaborationUser,
  path: string,
  cursor: { anchor: number; head: number } | null,
  emitCursorEvent: boolean,
) {
  const entry = collaborationPresenceEntrySchema.parse({
    connectionId: `orca:${user.id}`,
    user,
    path,
    cursor,
    lastSeenAt: new Date().toISOString(),
  });
  const now = Date.now();
  const hashKey = presenceHashKey(workspaceId);
  const expiryKey = presenceExpiryKey(workspaceId);
  const client = redisClient();
  const expired = await client.zrangebyscore(expiryKey, 0, now);
  const transaction = client.multi();
  if (expired.length) transaction.hdel(hashKey, ...expired);
  transaction.zremrangebyscore(expiryKey, 0, now);
  transaction.hset(hashKey, entry.connectionId, JSON.stringify(entry));
  transaction.zadd(expiryKey, now + PRESENCE_TTL_MS, entry.connectionId);
  transaction.pexpire(hashKey, PRESENCE_TTL_MS * 2);
  transaction.pexpire(expiryKey, PRESENCE_TTL_MS * 2);
  await transaction.exec();
  await appendPresenceEvent({
    workspaceId,
    type: "presence.active_file.changed",
    data: { userId: user.id, path, previousPath: null },
  });
  if (emitCursorEvent && entry.cursor) {
    await appendPresenceEvent({
      workspaceId,
      type: "presence.cursor.changed",
      data: { userId: user.id, path, cursor: entry.cursor },
    });
  }
  return entry;
}

export async function refreshPresence(
  workspaceId: string,
  connection: Connection,
) {
  if (!connection.joined) return;
  const entry: CollaborationPresenceEntry = {
    connectionId: connection.id,
    user: connection.user,
    path: connection.activePath,
    cursor: connection.cursor,
    lastSeenAt: new Date().toISOString(),
  };
  const now = Date.now();
  const hashKey = presenceHashKey(workspaceId);
  const expiryKey = presenceExpiryKey(workspaceId);
  const client = redisClient();
  const expired = await client.zrangebyscore(expiryKey, 0, now);
  const transaction = client.multi();
  if (expired.length) transaction.hdel(hashKey, ...expired);
  transaction.zremrangebyscore(expiryKey, 0, now);
  transaction.hset(hashKey, connection.id, JSON.stringify(entry));
  transaction.zadd(expiryKey, now + PRESENCE_TTL_MS, connection.id);
  transaction.pexpire(hashKey, PRESENCE_TTL_MS * 2);
  transaction.pexpire(expiryKey, PRESENCE_TTL_MS * 2);
  await transaction.exec();
  await broadcastPresence(workspaceId);
}

export async function removePresence(
  workspaceId: string,
  connection: Connection,
) {
  await redisClient()
    .multi()
    .hdel(presenceHashKey(workspaceId), connection.id)
    .zrem(presenceExpiryKey(workspaceId), connection.id)
    .exec();
  await broadcastPresence(workspaceId);
}

async function broadcastPresence(workspaceId: string) {
  const values = await redisClient().hvals(presenceHashKey(workspaceId));
  const members = values
    .flatMap((value) => {
      try {
        return [JSON.parse(value) as CollaborationPresenceEntry];
      } catch {
        return [];
      }
    })
    .slice(0, 100);
  broadcastLocal(workspaceId, { type: "presence", members });
}
