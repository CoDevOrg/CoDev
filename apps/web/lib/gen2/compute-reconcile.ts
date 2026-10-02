import "server-only";

import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { schema } from "@codev/db";

import { getDatabase } from "../platform/database";
import { logEvent } from "../platform/observability";
import { fakeGuestEnabled } from "../runtime/fake-guest";
import { getHostState } from "../runtime/host";
import { getSandbox } from "../runtime/orchestrator-sandbox";
import { OrchestratorError } from "../runtime/orchestrator-request";
import {
  MONTHLY_COMPUTE_LIMIT_MS,
  endComputeSession,
  startComputeSession,
  usedComputeMs,
} from "./compute-quota";
import { stopGen2Instance } from "./instance";

const IDLE_TIMEOUT_MS = 15 * 60_000;

async function inBatches<T>(
  items: T[],
  size: number,
  visit: (item: T) => Promise<void>,
) {
  for (let index = 0; index < items.length; index += size) {
    await Promise.all(items.slice(index, index + size).map(visit));
  }
}

function hibernatedAt(
  session: typeof schema.gen2ComputeSessions.$inferSelect,
  now: Date,
) {
  const idleAt = session.lastActivityAt
    ? session.lastActivityAt.getTime() + IDLE_TIMEOUT_MS
    : now.getTime();
  return new Date(
    Math.max(session.startedAt.getTime(), Math.min(now.getTime(), idleAt)),
  );
}

async function observeSession(
  session: typeof schema.gen2ComputeSessions.$inferSelect,
  now: Date,
) {
  try {
    const runtime = await getSandbox(session.workspaceId, 10_000);
    await getDatabase()
      .update(schema.gen2ComputeSessions)
      .set({ lastActivityAt: new Date(runtime.lastActivityAt) })
      .where(eq(schema.gen2ComputeSessions.id, session.id));
  } catch (error) {
    if (error instanceof OrchestratorError && error.status === 404) {
      await endComputeSession(session.workspaceId, hibernatedAt(session, now));
      return;
    }
    logEvent("warn", "gen2.compute.observe_failed", {
      workspaceId: session.workspaceId,
      detail: error instanceof Error ? error.message : "unknown",
    });
  }
}

async function bootstrapActiveSessions(now: Date) {
  const missing = await getDatabase()
    .select({
      workspaceId: schema.gen2Workspaces.id,
      ownerId: schema.gen2Workspaces.ownerId,
    })
    .from(schema.gen2Workspaces)
    .leftJoin(
      schema.gen2ComputeSessions,
      and(
        eq(schema.gen2ComputeSessions.workspaceId, schema.gen2Workspaces.id),
        isNull(schema.gen2ComputeSessions.endedAt),
      ),
    )
    .where(
      and(
        eq(schema.gen2Workspaces.status, "ready"),
        isNull(schema.gen2ComputeSessions.id),
      ),
    )
    .orderBy(sql`random()`)
    .limit(100);
  await inBatches(missing, 8, async (workspace) => {
    try {
      await getSandbox(workspace.workspaceId, 10_000);
      await startComputeSession(workspace.workspaceId, workspace.ownerId, now);
    } catch {
      // A persisted ready row does not imply a running guest.
    }
  });
}

async function stopExhaustedOwner(ownerId: string, now: Date) {
  if ((await usedComputeMs(ownerId, now)) < MONTHLY_COMPUTE_LIMIT_MS) return 0;
  const active = await getDatabase()
    .select({ workspaceId: schema.gen2ComputeSessions.workspaceId })
    .from(schema.gen2ComputeSessions)
    .where(
      and(
        eq(schema.gen2ComputeSessions.ownerId, ownerId),
        isNull(schema.gen2ComputeSessions.endedAt),
      ),
    );
  let stopped = 0;
  await inBatches(active, 4, async (session) => {
    try {
      await stopGen2Instance(session.workspaceId, ownerId);
      stopped++;
    } catch (error) {
      logEvent("error", "gen2.compute.stop_failed", {
        workspaceId: session.workspaceId,
        detail: error instanceof Error ? error.message : "unknown",
      });
    }
  });
  return stopped;
}

/** Reconcile active VM time and hibernate every guest once its owner's pool is spent. */
export async function reconcileComputeQuota(now = new Date()) {
  const hostStopped =
    !fakeGuestEnabled() &&
    (await getHostState().then(
      (state) => state === "stopped",
      () => false,
    ));
  if (!hostStopped) await bootstrapActiveSessions(now);
  const sessions = await getDatabase()
    .select()
    .from(schema.gen2ComputeSessions)
    .where(isNull(schema.gen2ComputeSessions.endedAt))
    .orderBy(asc(schema.gen2ComputeSessions.lastActivityAt))
    .limit(100);
  await inBatches(sessions, 8, async (session) => {
    if (hostStopped) {
      await endComputeSession(session.workspaceId, hibernatedAt(session, now));
    } else {
      await observeSession(session, now);
    }
  });
  const owners = [...new Set(sessions.map((session) => session.ownerId))];
  let stopped = 0;
  for (const ownerId of owners)
    stopped += await stopExhaustedOwner(ownerId, now);
  return { checked: sessions.length, stopped };
}
