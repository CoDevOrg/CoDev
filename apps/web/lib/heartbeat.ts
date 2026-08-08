import "server-only";

import { and, eq } from "drizzle-orm";
import Redis from "ioredis";

import { schema } from "@codev/db";

import { readServerEnvironment } from "@codev/config";

import { getDatabase } from "./database";
import { touchSandbox } from "./orchestrator";
import { workspaceRuntimeTtlMs } from "./workspaces";

const HEARTBEAT_KEY_PREFIX = "codev:workspace:heartbeat:";
let redis: Redis | undefined;

function redisClient() {
  if (!redis) {
    const url = readServerEnvironment().REDIS_URL;
    if (!url) return null;
    redis = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 1 });
  }
  return redis;
}

export async function hasLiveWorkspaceHeartbeat(workspaceId: string) {
  const client = redisClient();
  if (!client) return hasRecentPostgresActivity(workspaceId);
  try {
    if (client.status === "wait") await client.connect();
    if ((await client.exists(workspaceHeartbeatKey(workspaceId))) > 0) {
      return true;
    }
  } catch {
    // PostgreSQL remains authoritative when Redis is unavailable.
  }
  return hasRecentPostgresActivity(workspaceId);
}

async function hasRecentPostgresActivity(workspaceId: string) {
  const [state] = await getDatabase()
    .select({
      lastActivityAt: schema.workspaces.lastActivityAt,
      lastHeartbeatAt: schema.workspaceRuntimes.lastHeartbeatAt,
    })
    .from(schema.workspaces)
    .innerJoin(
      schema.workspaceRuntimes,
      eq(schema.workspaceRuntimes.workspaceId, schema.workspaces.id),
    )
    .where(eq(schema.workspaces.id, workspaceId))
    .limit(1);
  const latest = [state?.lastActivityAt, state?.lastHeartbeatAt]
    .filter((value): value is Date => value instanceof Date)
    .reduce<Date | null>(
      (current, value) =>
        !current || value.getTime() > current.getTime() ? value : current,
      null,
    );
  return Boolean(
    latest && Date.now() - latest.getTime() < workspaceRuntimeTtlMs,
  );
}

export async function recordWorkspaceHeartbeat(workspaceId: string) {
  const now = new Date();
  await getDatabase().transaction(async (transaction) => {
    await transaction
      .update(schema.workspaces)
      .set({ lastActivityAt: now, hibernateAt: null, updatedAt: now })
      .where(eq(schema.workspaces.id, workspaceId));
    await transaction
      .update(schema.workspaceRuntimes)
      .set({ lastHeartbeatAt: now, updatedAt: now })
      .where(
        and(
          eq(schema.workspaceRuntimes.workspaceId, workspaceId),
          eq(schema.workspaceRuntimes.status, "ready"),
        ),
      );
  });

  const client = redisClient();
  if (client) {
    try {
      if (client.status === "wait") await client.connect();
      await client.set(
        `${HEARTBEAT_KEY_PREFIX}${workspaceId}`,
        now.toISOString(),
        "PX",
        workspaceRuntimeTtlMs,
      );
    } catch {
      // PostgreSQL is authoritative; Redis is the low-latency liveness signal.
    }
  }

  await touchSandbox(workspaceId).catch(() => undefined);
  return { lastActivityAt: now, hibernateAt: null };
}

export function workspaceHeartbeatKey(workspaceId: string) {
  return `${HEARTBEAT_KEY_PREFIX}${workspaceId}`;
}
