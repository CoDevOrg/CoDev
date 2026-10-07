import "server-only";

import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { schema } from "@codev/db";

import { getDatabase } from "../platform/database";
import { logEvent } from "../platform/observability";
import { fakeGuestEnabled } from "../runtime/fake-guest";
import { getHostState } from "../runtime/host";
import { getSandbox } from "../runtime/orchestrator-sandbox";
import { OrchestratorError } from "../runtime/orchestrator-request";
import { ArmWorkspaceProvider } from "../runtime/arm-workspace-provider";
import { armWorkspaceAgentRunning } from "../runtime/arm-workspace-activity";
import {
  endComputeSession,
  ownerHasUnlimitedCompute,
  startComputeSession,
  usedComputeMs,
} from "./compute-quota";
import { reconcileArmWorkspaceTurns } from "./arm-workspace-turns-reconcile";
import { hasPendingArmWorkspaceTurns } from "./arm-workspace-pending-turns";
import { stopGen2Instance } from "./instance";
import { getWorkspaceOwnerEntitlement } from "../billing/workspace-entitlement";
import { getOwnerBudget } from "./owner-budget";
import { releaseFreeWorkspaceCompute } from "./free-compute-release";

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
  session: typeof schema.gen2ComputeSessions.$inferSelect & {
    runtimeProvider: string;
    runtimeGeneration: number;
    runtimeVmResourceId: string | null;
    runtimeStatus: string;
  },
  now: Date,
  hostStopped: boolean,
) {
  if (session.runtimeProvider === "azure_arm") {
    try {
      const state = await new ArmWorkspaceProvider().powerState(
        session.workspaceId,
        session.runtimeGeneration,
        session.runtimeVmResourceId,
      );
      if (!state || state === "PowerState/deallocated") {
        await endComputeSession(
          session.workspaceId,
          session.lastObservedAllocatedAt ?? session.startedAt,
        );
        if (session.runtimeStatus === "stopped")
          await releaseFreeWorkspaceCompute(getDatabase(), session.workspaceId);
        return;
      }
      await getDatabase()
        .update(schema.gen2ComputeSessions)
        .set({ lastObservedAllocatedAt: now })
        .where(eq(schema.gen2ComputeSessions.id, session.id));
      if (state === "PowerState/stopped") {
        await stopGen2Instance(session.workspaceId, session.ownerId);
        return;
      }
      const lastActivity = session.lastActivityAt ?? session.startedAt;
      if (
        session.runtimeStatus === "ready" &&
        now.getTime() - lastActivity.getTime() >= IDLE_TIMEOUT_MS
      ) {
        if (await armWorkspaceAgentRunning(session.workspaceId)) {
          await getDatabase()
            .update(schema.gen2ComputeSessions)
            .set({ lastActivityAt: now })
            .where(eq(schema.gen2ComputeSessions.id, session.id));
          return;
        }
        if (await hasPendingArmWorkspaceTurns(session.workspaceId)) return;
        await stopGen2Instance(session.workspaceId, session.ownerId);
      }
    } catch (error) {
      logEvent("warn", "gen2.compute.observe_failed", {
        workspaceId: session.workspaceId,
        detail: error instanceof Error ? error.message : "unknown",
      });
    }
    return;
  }
  if (hostStopped) {
    await endComputeSession(session.workspaceId, hibernatedAt(session, now));
    return;
  }
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

async function bootstrapActiveSessions(now: Date, hostStopped: boolean) {
  const missing = await getDatabase()
    .select({
      workspaceId: schema.gen2Workspaces.id,
      ownerId: schema.gen2Workspaces.ownerId,
      runtimeProvider: schema.gen2Workspaces.runtimeProvider,
      runtimeGeneration: schema.gen2Workspaces.runtimeGeneration,
      runtimeVmResourceId: schema.gen2Workspaces.runtimeVmResourceId,
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
        sql`(${schema.gen2Workspaces.status} = 'ready' OR (${schema.gen2Workspaces.runtimeProvider} = 'azure_arm' AND ${schema.gen2Workspaces.status} = 'provisioning'))`,
        isNull(schema.gen2ComputeSessions.id),
      ),
    )
    .orderBy(sql`random()`)
    .limit(100);
  await inBatches(missing, 8, async (workspace) => {
    try {
      if (workspace.runtimeProvider === "azure_arm") {
        const state = await new ArmWorkspaceProvider().powerState(
          workspace.workspaceId,
          workspace.runtimeGeneration,
          workspace.runtimeVmResourceId,
        );
        if (!state || state === "PowerState/deallocated") return;
      } else {
        if (hostStopped) return;
        await getSandbox(workspace.workspaceId, 10_000);
      }
      await startComputeSession(workspace.workspaceId, workspace.ownerId, now);
    } catch {
      // A persisted ready row does not imply a running guest.
    }
  });
}

async function stopExhaustedOwner(ownerId: string, now: Date) {
  if (await ownerHasUnlimitedCompute(ownerId)) return 0;
  const policy = await getWorkspaceOwnerEntitlement(ownerId);
  const exhausted =
    policy.monthlyLimitMs !== null &&
    (await usedComputeMs(ownerId, now, undefined, policy.usageWindow)) >=
      policy.monthlyLimitMs;
  const budgetBlocked =
    policy.tier === "free" &&
    (!policy.enabled || (await getOwnerBudget(ownerId, now)).blocked);
  if (!exhausted && !budgetBlocked) return 0;
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
  await reconcileArmWorkspaceTurns(now);
  const hostStopped =
    !fakeGuestEnabled() &&
    (await getHostState().then(
      (state) => state === "stopped",
      () => false,
    ));
  await bootstrapActiveSessions(now, hostStopped);
  const sessions = await getDatabase()
    .select({
      id: schema.gen2ComputeSessions.id,
      workspaceId: schema.gen2ComputeSessions.workspaceId,
      ownerId: schema.gen2ComputeSessions.ownerId,
      startedAt: schema.gen2ComputeSessions.startedAt,
      endedAt: schema.gen2ComputeSessions.endedAt,
      lastActivityAt: schema.gen2ComputeSessions.lastActivityAt,
      lastObservedAllocatedAt:
        schema.gen2ComputeSessions.lastObservedAllocatedAt,
      runtimeProvider: schema.gen2Workspaces.runtimeProvider,
      runtimeGeneration: schema.gen2Workspaces.runtimeGeneration,
      runtimeVmResourceId: schema.gen2Workspaces.runtimeVmResourceId,
      runtimeStatus: schema.gen2Workspaces.runtimeStatus,
    })
    .from(schema.gen2ComputeSessions)
    .innerJoin(
      schema.gen2Workspaces,
      eq(schema.gen2Workspaces.id, schema.gen2ComputeSessions.workspaceId),
    )
    .where(isNull(schema.gen2ComputeSessions.endedAt))
    .orderBy(asc(schema.gen2ComputeSessions.lastActivityAt))
    .limit(100);
  await inBatches(sessions, 8, async (session) => {
    await observeSession(session, now, hostStopped);
  });
  const owners = [...new Set(sessions.map((session) => session.ownerId))];
  let stopped = 0;
  for (const ownerId of owners)
    stopped += await stopExhaustedOwner(ownerId, now);
  return { checked: sessions.length, stopped };
}
