import "server-only";

import {
  collaborationPresenceEntrySchema,
  type CollaborationPresenceEntry,
} from "@codev/contracts";

import type { Connection } from "./collaboration-connection";
import {
  PRESENCE_TTL_MS,
  presenceExpiryKey,
  presenceHashKey,
  redisClient,
} from "./collaboration-redis";
import { broadcastLocal } from "./collaboration-rooms";

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
    worktreeId: connection.worktreeId,
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
        const parsed = collaborationPresenceEntrySchema.safeParse(
          JSON.parse(value),
        );
        return parsed.success ? [parsed.data] : [];
      } catch {
        return [];
      }
    })
    .slice(0, 100);
  await broadcastLocal(workspaceId, { type: "presence", members });
}
