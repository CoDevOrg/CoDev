import "server-only";
import type { Gen2OwnerComputeSummary } from "@codev/contracts";
import { getWorkspaceOwnerEntitlement } from "../billing/workspace-entitlement";
import { computeMonth, usedComputeMs } from "./compute-quota";
import { getOwnerBudget } from "./owner-budget";

export async function getOwnerComputeSummary(
  ownerId: string,
  now = new Date(),
): Promise<Gen2OwnerComputeSummary> {
  const policy = await getWorkspaceOwnerEntitlement(ownerId);
  const [used, budget] = await Promise.all([
    usedComputeMs(ownerId, now),
    policy.tier === "free" && policy.enabled
      ? getOwnerBudget(ownerId, now)
      : null,
  ]);
  return {
    minutesUsed: Math.ceil(used / 60_000),
    minutesLimit:
      policy.monthlyLimitMs === null ? null : policy.monthlyLimitMs / 60_000,
    unlimited: policy.unlimited,
    resetsAt: computeMonth(now).end.toISOString(),
    tier: policy.tier,
    freeEnabled: policy.tier === "free" && policy.enabled,
    ownedWorkspaceCount: policy.ownedWorkspaceCount,
    activeWorkspaceLimit: policy.tier === "free" ? 1 : null,
    armBootMinutesCount: true,
    budget,
  };
}
