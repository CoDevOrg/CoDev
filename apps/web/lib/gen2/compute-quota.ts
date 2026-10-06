import "server-only";

import { and, eq, gt, isNull, lt, or } from "drizzle-orm";
import { schema } from "@codev/db";

import { isUserAdmin } from "../admin/admin";
import { getWorkspaceOwnerEntitlement } from "../billing/workspace-entitlement";
import type { ComputeDatabase } from "./compute-database";
import { getDatabase } from "../platform/database";
import { fakeGuestEnabled } from "../runtime/fake-guest";
import { getHostState } from "../runtime/host";
import { OrchestratorError } from "../runtime/orchestrator-request";
import { getSandbox } from "../runtime/orchestrator-sandbox";
import { ArmWorkspaceProvider } from "../runtime/arm-workspace-provider";
import { Gen2LifecycleError } from "./errors";

export { GEN2_PAID_MONTHLY_COMPUTE_LIMIT_MS as MONTHLY_COMPUTE_LIMIT_MS } from "../billing/config";

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

export async function usedComputeMs(
  ownerId: string,
  now = new Date(),
  db: ComputeDatabase = getDatabase(),
  usageWindow: "lifetime" | "month" = "month",
) {
  const month = computeMonth(now);
  const intervals = await db
    .select({
      startedAt: schema.gen2ComputeSessions.startedAt,
      endedAt: schema.gen2ComputeSessions.endedAt,
    })
    .from(schema.gen2ComputeSessions)
    .where(
      usageWindow === "lifetime"
        ? eq(schema.gen2ComputeSessions.ownerId, ownerId)
        : and(
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
      (usageWindow === "lifetime"
        ? Math.max(
            0,
            (interval.endedAt ?? now).getTime() - interval.startedAt.getTime(),
          )
        : intervalWithinMonth(
            interval.startedAt,
            interval.endedAt ?? now,
            now,
          )),
    0,
  );
}

export async function assertComputeAvailable(
  ownerId: string,
  now = new Date(),
  db: ComputeDatabase = getDatabase(),
) {
  const policy = await getWorkspaceOwnerEntitlement(ownerId, db);
  if (policy.monthlyLimitMs === null) return;
  if (
    (await usedComputeMs(ownerId, now, db, policy.usageWindow)) <
    policy.monthlyLimitMs
  )
    return;
  throw new Gen2LifecycleError(
    policy.usageWindow === "lifetime"
      ? `You've used your ${policy.monthlyLimitMs / 3_600_000} free workspace hours. Your work is saved; subscribe to reconnect.`
      : `You've used your ${policy.monthlyLimitMs / 60_000} workspace minutes for this month. Your work is saved; you can reconnect next month.`,
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
    .values({
      workspaceId,
      ownerId,
      startedAt,
      lastObservedAllocatedAt: startedAt,
    })
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
  const [workspace] = await getDatabase()
    .select()
    .from(schema.gen2Workspaces)
    .where(eq(schema.gen2Workspaces.id, workspaceId))
    .limit(1);
  if (workspace?.runtimeProvider === "azure_arm") {
    const state = await new ArmWorkspaceProvider().powerState(
      workspaceId,
      workspace.runtimeGeneration,
      workspace.runtimeVmResourceId,
    );
    if (!state || state === "PowerState/deallocated")
      await endComputeSession(
        workspaceId,
        session.lastObservedAllocatedAt ?? session.startedAt,
      );
    return;
  }
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

type ComputeTransaction = import("./compute-database").ComputeTransaction;

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
  await transaction.insert(schema.gen2ComputeSessions).values({
    workspaceId,
    ownerId: newOwnerId,
    startedAt: now,
    lastObservedAllocatedAt: now,
  });
}
