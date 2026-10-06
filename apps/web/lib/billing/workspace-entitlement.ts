import "server-only";
import { count, eq } from "drizzle-orm";
import { schema } from "@codev/db";
import type { Gen2OwnerComputeEntitlement } from "@codev/contracts";
import { getDatabase } from "../platform/database";
import type { ComputeDatabase } from "../gen2/compute-database";
import { resolveBillingAccess } from "./access";
import { GEN2_FREE_LIFETIME_COMPUTE_LIMIT_MS } from "./config";
import { FREE_PLAN, getBillingPlan } from "./plans";

export async function getWorkspaceOwnerEntitlement(
  ownerId: string,
  db: ComputeDatabase = getDatabase(),
): Promise<Gen2OwnerComputeEntitlement> {
  const [[user], [subscription], [owned]] = await Promise.all([
    db
      .select({ isAdmin: schema.users.isAdmin })
      .from(schema.users)
      .where(eq(schema.users.id, ownerId))
      .limit(1),
    db
      .select()
      .from(schema.organizationSubscriptions)
      .where(eq(schema.organizationSubscriptions.organizationId, ownerId))
      .limit(1),
    db
      .select({ count: count() })
      .from(schema.gen2Workspaces)
      .where(eq(schema.gen2Workspaces.ownerId, ownerId)),
  ]);
  const unlimited = Boolean(user?.isAdmin);
  const access = resolveBillingAccess({
    isAdmin: unlimited,
    row: subscription ?? null,
  });
  const paid = access.hasAccess;
  const plan = getBillingPlan(
    access.source === "admin" ? "enterprise" : (subscription?.planId ?? "free"),
  );
  const countOwned = owned?.count ?? 0;
  const allowed = process.env.GEN2_FREE_ARM_OWNER_IDS?.split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  const enabled =
    process.env.GEN2_FREE_ARM_ENABLED === "true" &&
    (!allowed?.length || allowed.includes(ownerId));
  return {
    tier: paid ? "paid" : "free",
    enabled: paid || enabled,
    unlimited,
    ownedWorkspaceCount: countOwned,
    usageWindow: paid ? "month" : "lifetime",
    monthlyLimitMs: unlimited
      ? null
      : paid
        ? (plan.monthlyComputeHours ?? 0) * 3_600_000
        : GEN2_FREE_LIFETIME_COMPUTE_LIMIT_MS,
    workspaceLimit: unlimited
      ? 20
      : paid
        ? plan.workspaceLimit
        : FREE_PLAN.workspaceLimit,
    activeWorkspaceLimit: unlimited
      ? 10
      : paid
        ? plan.activeWorkspaceLimit
        : FREE_PLAN.activeWorkspaceLimit,
  };
}
