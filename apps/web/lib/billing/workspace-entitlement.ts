import "server-only";
import { count, eq } from "drizzle-orm";
import { schema } from "@codev/db";
import type { Gen2OwnerComputeEntitlement } from "@codev/contracts";
import { getDatabase } from "../platform/database";
import type { ComputeDatabase } from "../gen2/compute-database";
import { resolveBillingAccess } from "./access";
import {
  GEN2_PAID_MONTHLY_COMPUTE_LIMIT_MS,
  GEN2_FREE_ONE_WORKSPACE_LIMIT_MS,
  GEN2_FREE_TWO_WORKSPACE_LIMIT_MS,
} from "./config";

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
  const paid = resolveBillingAccess({
    isAdmin: unlimited,
    row: subscription ?? null,
  }).hasAccess;
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
    monthlyLimitMs: unlimited
      ? null
      : paid || !enabled
        ? GEN2_PAID_MONTHLY_COMPUTE_LIMIT_MS
        : countOwned >= 2
          ? GEN2_FREE_TWO_WORKSPACE_LIMIT_MS
          : GEN2_FREE_ONE_WORKSPACE_LIMIT_MS,
  };
}
