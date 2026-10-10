import "server-only";

import {
  collaborationPresenceEntrySchema,
  type CollaborationPresenceEntry,
} from "@codev/contracts";

import type { Connection } from "./collaboration-connection";
import {
  PRESENCE_TTL_MS,
  getInstanceId,
  presenceExpiryKey,
  presenceHashKey,
  redisClient,
} from "./collaboration-redis";
import { broadcastLocal, signalPresenceSync } from "./collaboration-rooms";

const BROADCAST_DEBOUNCE_MS = 250;
const AGENT_PRESENCE_TTL_MS = 90_000;
const pendingBroadcasts = new Map<string, Promise<void>>();

/**
 * Writes this connection's entry. `changed` marks a visible change (join,
 * focus, file) that other instances must hear about now rather than at their
 * next heartbeat.
 */
export async function refreshPresence(
  workspaceId: string,
  connection: Connection,
  options: { changed?: boolean } = {},
) {
  if (!connection.joined) return;
  await writePresence(
    workspaceId,
    {
      connectionId: connection.id,
      user: connection.user,
      path: connection.activePath,
      cursor: connection.cursor,
      worktreeId: connection.worktreeId,
      agent: null,
      view: connection.view,
      chatId: connection.chatId,
      away: connection.away,
      lastSeenAt: new Date().toISOString(),
    },
    PRESENCE_TTL_MS,
  );
  if (options.changed) await signalPresenceSync(workspaceId);
  await scheduleBroadcast(workspaceId);
}

/** A running agent appears beside members until its turn settles. */
export async function setAgentPresence(
  workspaceId: string,
  entry: Omit<CollaborationPresenceEntry, "connectionId" | "lastSeenAt">,
) {
  if (!entry.agent) return;
  await writePresence(
    workspaceId,
    {
      ...entry,
      connectionId: agentConnectionId(entry.agent.sessionId),
      lastSeenAt: new Date().toISOString(),
    },
    AGENT_PRESENCE_TTL_MS,
  );
  await signalPresenceSync(workspaceId);
  await scheduleBroadcast(workspaceId);
}

export async function readAgentPresence(
  workspaceId: string,
  sessionId: string,
) {
  const value = await redisClient().hget(
    presenceHashKey(workspaceId),
    agentConnectionId(sessionId),
  );
  return value ? parseEntry(value) : null;
}

export async function removeAgentPresence(
  workspaceId: string,
  sessionId: string,
) {
  await deleteEntry(workspaceId, agentConnectionId(sessionId));
}

export async function removePresence(
  workspaceId: string,
  connection: Connection,
) {
  await deleteEntry(workspaceId, connection.id);
}

/** Re-reads every entry and sends the list to this instance's sockets. */
export async function broadcastPresence(workspaceId: string) {
  const values = await redisClient().hvals(presenceHashKey(workspaceId));
  const members = values.flatMap((value) => parseEntry(value) ?? []);
  await broadcastLocal(workspaceId, {
    type: "presence",
    members: members.slice(0, 100),
  });
}

function agentConnectionId(sessionId: string) {
  return `agent:${sessionId}`;
}

function parseEntry(value: string) {
  try {
    const parsed = collaborationPresenceEntrySchema.safeParse(
      JSON.parse(value),
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

async function writePresence(
  workspaceId: string,
  entry: CollaborationPresenceEntry,
  ttlMs: number,
) {
  const now = Date.now();
  const hashKey = presenceHashKey(workspaceId);
  const expiryKey = presenceExpiryKey(workspaceId);
  const client = redisClient();
  const expired = await client.zrangebyscore(expiryKey, 0, now);
  const transaction = client.multi();
  if (expired.length) transaction.hdel(hashKey, ...expired);
  transaction.zremrangebyscore(expiryKey, 0, now);
  transaction.hset(hashKey, entry.connectionId, JSON.stringify(entry));
  transaction.zadd(expiryKey, now + ttlMs, entry.connectionId);
  transaction.pexpire(hashKey, AGENT_PRESENCE_TTL_MS * 2);
  transaction.pexpire(expiryKey, AGENT_PRESENCE_TTL_MS * 2);
  await transaction.exec();
}

async function deleteEntry(workspaceId: string, connectionId: string) {
  await redisClient()
    .multi()
    .hdel(presenceHashKey(workspaceId), connectionId)
    .zrem(presenceExpiryKey(workspaceId), connectionId)
    .exec();
  await signalPresenceSync(workspaceId);
  await scheduleBroadcast(workspaceId);
}

/**
 * Coalesces bursts (several members joining, an agent touching files) into
 * one fan-out. Keyed by instance so a Worker socket's own context sends it.
 */
function scheduleBroadcast(workspaceId: string) {
  const key = `${getInstanceId()}:${workspaceId}`;
  const existing = pendingBroadcasts.get(key);
  if (existing) return existing;
  const run = new Promise<void>((resolve) =>
    setTimeout(resolve, BROADCAST_DEBOUNCE_MS),
  ).then(() => {
    pendingBroadcasts.delete(key);
    return broadcastPresence(workspaceId);
  });
  pendingBroadcasts.set(key, run);
  return run;
}
