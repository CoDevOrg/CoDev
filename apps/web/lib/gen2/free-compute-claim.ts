import "server-only";
import { eq } from "drizzle-orm";
import { findOtherOwnerCompute } from "./free-active-workspace";
import { schema } from "@codev/db";
import { getWorkspaceOwnerEntitlement } from "../billing/workspace-entitlement";
import { getDatabase } from "../platform/database";
import { lockComputeOwners } from "./compute-database";
import {
  reconcileWorkspaceComputeSession,
  assertComputeAvailable,
} from "./compute-quota";
import { assertOwnerBudget } from "./owner-budget-guard";
import { Gen2LifecycleError, FreeComputeConflictError } from "./errors";

export async function reserveFreeWorkspaceCompute(workspaceId: string) {
  await reconcileWorkspaceComputeSession(workspaceId);
  return getDatabase().transaction(async (db) => {
    const [workspace] = await db
      .select()
      .from(schema.gen2Workspaces)
      .where(eq(schema.gen2Workspaces.id, workspaceId))
      .limit(1);
    if (!workspace) throw new Gen2LifecycleError("Workspace not found.", 404);
    await lockComputeOwners(db, [workspace.ownerId]);
    const [current] = await db
      .select()
      .from(schema.gen2Workspaces)
      .where(eq(schema.gen2Workspaces.id, workspaceId))
      .for("update");
    if (!current || current.ownerId !== workspace.ownerId)
      throw new Gen2LifecycleError(
        "Workspace ownership changed. Try again.",
        409,
      );
    const policy = await getWorkspaceOwnerEntitlement(current.ownerId, db);
    if (
      policy.tier === "free" &&
      (!policy.enabled || current.runtimeProvider !== "azure_arm")
    )
      throw new Gen2LifecycleError(
        "Free ARM compute is not enabled for this workspace.",
        403,
      );
    await assertComputeAvailable(current.ownerId, new Date(), db);
    if (policy.tier === "free") await assertOwnerBudget(current.ownerId, db);
    const others = await findOtherOwnerCompute(
      db,
      current.ownerId,
      workspaceId,
    );
    if (others.length >= policy.activeWorkspaceLimit) {
      if (policy.activeWorkspaceLimit === 1 && others[0]) {
        throw new FreeComputeConflictError(others[0]);
      }
      throw new Gen2LifecycleError(
        `Your plan allows ${policy.activeWorkspaceLimit} active workspaces at a time. Stop one or change plans to start another.`,
        409,
      );
    }
    await db
      .insert(schema.gen2FreeComputeClaims)
      .values({ ownerId: current.ownerId, workspaceId })
      .onConflictDoUpdate({
        target: [
          schema.gen2FreeComputeClaims.ownerId,
          schema.gen2FreeComputeClaims.workspaceId,
        ],
        set: { claimedAt: new Date() },
      });
  });
}
