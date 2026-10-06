import "server-only";
import { and, count, eq, ne } from "drizzle-orm";
import { schema } from "@codev/db";
import { getWorkspaceOwnerEntitlement } from "../billing/workspace-entitlement";
import { lockComputeOwners, type ComputeTransaction } from "./compute-database";
import { assertComputeAvailable } from "./compute-quota";
import { assertOwnerBudget } from "./owner-budget-guard";
import { Gen2LifecycleError } from "./errors";
import { FreeComputeConflictError } from "./errors";
import { findOtherOwnerCompute } from "./free-active-workspace";

export async function prepareWorkspaceOwnerTransfer(
  db: ComputeTransaction,
  workspaceId: string,
  newOwnerId: string,
  expectedOwnerId?: string,
) {
  const workspace = await lockTransferredWorkspace(
    db,
    workspaceId,
    newOwnerId,
    expectedOwnerId,
  );
  const [owned] = await db
    .select({ count: count() })
    .from(schema.gen2Workspaces)
    .where(
      and(
        eq(schema.gen2Workspaces.ownerId, newOwnerId),
        ne(schema.gen2Workspaces.id, workspaceId),
      ),
    );
  const policy = await getWorkspaceOwnerEntitlement(newOwnerId, db);
  if ((owned?.count ?? 0) >= policy.workspaceLimit)
    throw new Gen2LifecycleError(
      `The new owner's plan includes ${policy.workspaceLimit} workspace${policy.workspaceLimit === 1 ? "" : "s"}.`,
      409,
    );
  const active =
    workspace.status === "ready" || Boolean(workspace.runtimeVmResourceId);
  if (active && policy.tier === "paid") {
    await assertComputeAvailable(newOwnerId, new Date(), db);
    const otherActive = await findOtherOwnerCompute(
      db,
      newOwnerId,
      workspace.id,
    );
    if (otherActive.length >= policy.activeWorkspaceLimit) {
      throw new Gen2LifecycleError(
        `The new owner's plan allows ${policy.activeWorkspaceLimit} active workspaces at a time.`,
        409,
      );
    }
  }
  if (active && policy.tier === "free")
    await acceptActiveFreeTransfer(db, workspace, newOwnerId, policy.enabled);
  await transferClaim(db, workspace, newOwnerId, active);
}

async function lockTransferredWorkspace(
  db: ComputeTransaction,
  workspaceId: string,
  newOwnerId: string,
  expectedOwnerId?: string,
) {
  const [before] = await db
    .select()
    .from(schema.gen2Workspaces)
    .where(eq(schema.gen2Workspaces.id, workspaceId))
    .limit(1);
  if (!before) throw new Gen2LifecycleError("Workspace not found.", 404);
  await lockComputeOwners(db, [before.ownerId, newOwnerId]);
  const [workspace] = await db
    .select()
    .from(schema.gen2Workspaces)
    .where(eq(schema.gen2Workspaces.id, workspaceId))
    .for("update");
  if (
    !workspace ||
    workspace.ownerId !== before.ownerId ||
    (expectedOwnerId && workspace.ownerId !== expectedOwnerId) ||
    workspace.status === "deleting"
  )
    throw new Gen2LifecycleError(
      "Workspace ownership changed. Try again.",
      409,
    );
  if (workspace.status === "provisioning")
    throw new Gen2LifecycleError(
      "Wait for the lifecycle operation to finish before transferring ownership.",
      409,
    );
  const [claim] = await db
    .select()
    .from(schema.gen2FreeComputeClaims)
    .where(eq(schema.gen2FreeComputeClaims.workspaceId, workspaceId))
    .limit(1);
  if (claim && workspace.status === "pending")
    throw new Gen2LifecycleError(
      "Cancel the startup reservation before transferring ownership.",
      409,
    );
  return workspace;
}

async function acceptActiveFreeTransfer(
  db: ComputeTransaction,
  workspace: typeof schema.gen2Workspaces.$inferSelect,
  newOwnerId: string,
  enabled: boolean,
) {
  if (!enabled || workspace.runtimeProvider !== "azure_arm")
    throw new Gen2LifecycleError(
      "Stop this workspace before transferring it to a free owner.",
      409,
    );
  const active = await findOtherOwnerCompute(db, newOwnerId, workspace.id);
  if (active[0]) throw new FreeComputeConflictError(active[0]);
  await assertComputeAvailable(newOwnerId, new Date(), db);
  await assertOwnerBudget(newOwnerId, db);
}

async function transferClaim(
  db: ComputeTransaction,
  workspace: typeof schema.gen2Workspaces.$inferSelect,
  newOwnerId: string,
  claimActive: boolean,
) {
  await db
    .delete(schema.gen2FreeComputeClaims)
    .where(
      and(
        eq(schema.gen2FreeComputeClaims.workspaceId, workspace.id),
        eq(schema.gen2FreeComputeClaims.ownerId, workspace.ownerId),
      ),
    );
  if (claimActive)
    await db
      .insert(schema.gen2FreeComputeClaims)
      .values({ ownerId: newOwnerId, workspaceId: workspace.id })
      .onConflictDoUpdate({
        target: [
          schema.gen2FreeComputeClaims.ownerId,
          schema.gen2FreeComputeClaims.workspaceId,
        ],
        set: { workspaceId: workspace.id, claimedAt: new Date() },
      });
}
