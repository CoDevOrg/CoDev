import "server-only";
import { BillingRequiredError } from "../billing/access";
import { getWorkspaceOwnerEntitlement } from "../billing/workspace-entitlement";
import type { ComputeTransaction } from "./compute-database";
import { Gen2LifecycleError } from "./errors";

export async function workspaceCreationPolicy(
  db: ComputeTransaction,
  ownerId: string,
  ownedCount: number,
  acknowledgeReducedQuota: boolean,
) {
  void acknowledgeReducedQuota;
  const policy = await getWorkspaceOwnerEntitlement(ownerId, db);
  if (ownedCount >= policy.workspaceLimit) {
    throw new Gen2LifecycleError(
      `Your plan includes ${policy.workspaceLimit} workspace${policy.workspaceLimit === 1 ? "" : "s"}. Delete one or change plans to create another.`,
      409,
    );
  }
  if (policy.tier === "paid") return "azure_arm" as const;
  if (!policy.enabled) throw new BillingRequiredError();
  return "azure_arm" as const;
}
