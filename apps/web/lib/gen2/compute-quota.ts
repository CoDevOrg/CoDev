import "server-only";

import { and, eq, gt, isNull, lt, or } from "drizzle-orm";
import { schema } from "@codev/db";

import { isUserAdmin } from "../admin/admin";
import { getDatabase } from "../platform/database";
import { fakeGuestEnabled } from "../runtime/fake-guest";
import { getHostState } from "../runtime/host";
import { OrchestratorError } from "../runtime/orchestrator-request";
import { getSandbox } from "../runtime/orchestrator-sandbox";
import { Gen2LifecycleError } from "./errors";

export const MONTHLY_COMPUTE_LIMIT_MS = 1_000 * 60_000;

export async function ownerHasUnlimitedCompute(ownerId: string) {
  return isUserAdmin(ownerId);
}

export function computeMonth(now: Date) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
  );
  return { start, end };
}

export function intervalWithinMonth(startedAt: Date, endedAt: Date, now: Date) {
  const month = computeMonth(now);
  return Math.max(
    0,
    Math.min(endedAt.getTime(), month.end.getTime()) -
      Math.max(startedAt.getTime(), month.start.getTime()),
  );
}

export async function usedComputeMs(ownerId: string, now = new Date()) {
  const month = computeMonth(now);
  const intervals = await getDatabase()
    .select({
      startedAt: schema.gen2ComputeSessions.startedAt,
      endedAt: schema.gen2ComputeSessions.endedAt,
    })
    .from(schema.gen2ComputeSessions)
    .where(
      and(
        eq(schema.gen2ComputeSessions.ownerId, ownerId),
        lt(schema.gen2ComputeSessions.startedAt, month.end),
        or(
          isNull(schema.gen2ComputeSessions.endedAt),
          gt(schema.gen2ComputeSessions.endedAt, month.start),
        ),
      ),
    );
  return intervals.reduce(
    (total, interval) =>
      total +
      intervalWithinMonth(interval.startedAt, interval.endedAt ?? now, now),
    0,
  );
}

export async function assertComputeAvailable(
  ownerId: string,
  now = new Date(),
) {
  if (await ownerHasUnlimitedCompute(ownerId)) return;
  if ((await usedComputeMs(ownerId, now)) < MONTHLY_COMPUTE_LIMIT_MS) return;
  throw new Gen2LifecycleError(
    "You've used your 1,000 workspace minutes for this month. Your work is saved; you can reconnect next month.",
    429,
  );
}

export async function workspaceOwnerId(workspaceId: string) {
  const [workspace] = await getDatabase()
    .select({ ownerId: schema.gen2Workspaces.ownerId })
    .from(schema.gen2Workspaces)
    .where(eq(schema.gen2Workspaces.id, workspaceId))
    .limit(1);
  if (!workspace) throw new Gen2LifecycleError("Workspace not found.", 404);
  return workspace.ownerId;
}

export async function startComputeSession(
  workspaceId: string,
  ownerId: string,
  startedAt = new Date(),
) {
  await getDatabase()
    .insert(schema.gen2ComputeSessions)
    .values({ workspaceId, ownerId, startedAt })
    .onConflictDoNothing();
}

export async function endComputeSession(
  workspaceId: string,
  endedAt = new Date(),
) {
  await getDatabase()
    .update(schema.gen2ComputeSessions)
    .set({ endedAt })
    .where(
      and(
        eq(schema.gen2ComputeSessions.workspaceId, workspaceId),
        isNull(schema.gen2ComputeSessions.endedAt),
      ),
    );
}

/** Clear an idle interval before denying a reconnect on a stale monthly total. */
export async function reconcileWorkspaceComputeSession(
  workspaceId: string,
  now = new Date(),
) {
  const [session] = await getDatabase()
    .select()
    .from(schema.gen2ComputeSessions)
    .where(
      and(
        eq(schema.gen2ComputeSessions.workspaceId, workspaceId),
        isNull(schema.gen2ComputeSessions.endedAt),
      ),
    )
    .limit(1);
  if (!session) return;
  const hostStopped =
    !fakeGuestEnabled() &&
    (await getHostState().then(
      (state) => state === "stopped",
      () => false,
    ));
  if (!hostStopped) {
    try {
      await getSandbox(workspaceId, 10_000);
      return;
    } catch (error) {
      if (!(error instanceof OrchestratorError) || error.status !== 404) return;
    }
  }
  const idleAt = session.lastActivityAt
    ? session.lastActivityAt.getTime() + 15 * 60_000
    : now.getTime();
  await endComputeSession(
    workspaceId,
    new Date(
      Math.max(session.startedAt.getTime(), Math.min(now.getTime(), idleAt)),
    ),
  );
}

type ComputeTransaction = Parameters<
  Parameters<ReturnType<typeof getDatabase>["transaction"]>[0]
>[0];

export async function transferActiveComputeSession(
  transaction: ComputeTransaction,
  workspaceId: string,
  newOwnerId: string,
  now = new Date(),
) {
  const ended = await transaction
    .update(schema.gen2ComputeSessions)
    .set({ endedAt: now })
    .where(
      and(
        eq(schema.gen2ComputeSessions.workspaceId, workspaceId),
        isNull(schema.gen2ComputeSessions.endedAt),
      ),
    )
    .returning({ id: schema.gen2ComputeSessions.id });
  if (!ended.length) return;
  await transaction
    .insert(schema.gen2ComputeSessions)
    .values({ workspaceId, ownerId: newOwnerId, startedAt: now });
}
