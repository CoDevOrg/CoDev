import "server-only";

import { randomUUID } from "node:crypto";

import { readServerEnvironment } from "@codev/config";
import Redis from "ioredis";
import { cache } from "react";
import { after } from "next/server";
import { collaborationContext } from "./collaboration-context";

export const MAX_SOCKET_PAYLOAD_BYTES = 128 * 1_024;
export const HEARTBEAT_INTERVAL_MS = 20_000;
export const PRESENCE_TTL_MS = 60_000;
export const STREAM_MAX_LENGTH = 2_000;
export const REPLAY_LIMIT = 250;
const LOCK_TTL_MS = 75_000;

/** Distinguishes this process's own stream writes from another instance's. */
let instanceId: string | undefined;

export function getInstanceId() {
  const current = collaborationContext.getStore();
  if (current) return (current.instanceId ??= randomUUID());
  return (instanceId ??= randomUUID());
}

let redis: Redis | undefined;

function createRedisClient() {
  const url = readServerEnvironment().REDIS_URL;
  if (!url)
    throw new Error("REDIS_URL is required for realtime collaboration.");
  const client = new Redis(url, {
    lazyConnect: true,
    maxRetriesPerRequest: 2,
    enableReadyCheck: true,
  });
  client.on("error", () => undefined);
  return client;
}

const requestRedis = cache(() => {
  const client = createRedisClient();
  after(() => client.disconnect());
  return client;
});

export function redisClient() {
  const current = collaborationContext.getStore();
  if (current) return (current.redis ??= createRedisClient());
  if (typeof WebSocketPair === "function") return requestRedis();
  return (redis ??= createRedisClient());
}

export function streamKey(workspaceId: string) {
  return `codev:collaboration:${workspaceId}:events`;
}

export function presenceHashKey(workspaceId: string) {
  return `codev:collaboration:${workspaceId}:presence`;
}

export function presenceExpiryKey(workspaceId: string) {
  return `codev:collaboration:${workspaceId}:presence-expiry`;
}

function documentLockKey(
  workspaceId: string,
  worktreeId: string,
  path: string,
) {
  return `codev:collaboration:${workspaceId}:${worktreeId}:lock:${Buffer.from(path).toString("base64url")}`;
}

export async function withDocumentLock<T>(
  workspaceId: string,
  worktreeId: string,
  path: string,
  callback: () => Promise<T>,
) {
  const key = documentLockKey(workspaceId, worktreeId, path);
  const token = randomUUID();
  const client = redisClient();
  const acquired = await client.set(key, token, "PX", LOCK_TTL_MS, "NX");
  if (!acquired) throw new Error("Document is busy; retry the update.");
  try {
    return await callback();
  } finally {
    await client.eval(
      "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) end return 0",
      1,
      key,
      token,
    );
  }
}

export async function checkRealtimeConnection() {
  const client = redisClient();
  if (client.status === "wait") await client.connect();
  const response = await client.ping();
  if (response !== "PONG") {
    throw new Error("The realtime data service did not respond.");
  }
}
