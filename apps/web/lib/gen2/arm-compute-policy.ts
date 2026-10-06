import "server-only";
import { and, eq } from "drizzle-orm";
import { schema } from "@codev/db";
import { getWorkspaceOwnerEntitlement } from "../billing/workspace-entitlement";
import type { ComputeDatabase } from "./compute-database";
import { assertComputeAvailable } from "./compute-quota";
import { assertOwnerBudget } from "./owner-budget-guard";
import { Gen2LifecycleError } from "./errors";

/** Workflow checks run again after boot; queued work cannot outlive its owner's allowance. */
export async function enforceArmComputeEntitlement(
  db: ComputeDatabase,
  workspaceId: string,
  ownerId: string,
) {
  const policy = await getWorkspaceOwnerEntitlement(ownerId, db);
  await assertComputeAvailable(ownerId, new Date(), db);
  if (policy.tier === "free" && !policy.enabled)
    throw new Gen2LifecycleError("Free ARM compute is not enabled.", 403);
  if (policy.tier === "free") await assertOwnerBudget(ownerId, db);
  const [claim] = await db
    .select()
    .from(schema.gen2FreeComputeClaims)
    .where(
      and(
        eq(schema.gen2FreeComputeClaims.ownerId, ownerId),
        eq(schema.gen2FreeComputeClaims.workspaceId, workspaceId),
      ),
    )
    .limit(1);
  if (!claim)
    throw new Gen2LifecycleError(
      "The workspace compute reservation changed. Try again.",
      409,
    );
}
