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
  const policy = await getWorkspaceOwnerEntitlement(ownerId, db);
  if (policy.tier === "paid") return "azure_arm" as const;
  if (!policy.enabled) throw new BillingRequiredError();
  if (ownedCount >= 1 && !acknowledgeReducedQuota) {
    throw new Gen2LifecycleError(
      "Adding a second workspace gives you more storage and changes your monthly workspace time from 50 hours to 35 hours. Both workspaces share those 35 hours. Acknowledge this change before creating it.",
      409,
    );
  }
  return "azure_arm" as const;
}
