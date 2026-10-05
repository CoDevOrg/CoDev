import "server-only";

import { eq } from "drizzle-orm";

import { schema } from "@codev/db";

import { getDatabase } from "../platform/database";
import { requireIndividualPlan } from "./access";
import { getWorkspaceOwnerEntitlement } from "./workspace-entitlement";
import { reserveFreeWorkspaceCompute } from "../gen2/free-compute-claim";

/** Owner-funded compute: paid access or an eligible free ARM reservation.
 * Collaborators consume their current owner's allowance. Missing workspaces
 * remain the caller's membership check (404).
 */
export async function requireWorkspaceOwnerPlan(workspaceId: string) {
  const [workspace] = await getDatabase()
    .select({
      ownerId: schema.gen2Workspaces.ownerId,
      runtimeProvider: schema.gen2Workspaces.runtimeProvider,
    })
    .from(schema.gen2Workspaces)
    .where(eq(schema.gen2Workspaces.id, workspaceId))
    .limit(1);
  if (!workspace) return;
  const policy = await getWorkspaceOwnerEntitlement(workspace.ownerId);
  if (
    policy.tier === "paid" ||
    !policy.enabled ||
    workspace.runtimeProvider !== "azure_arm"
  ) {
    await requireIndividualPlan(workspace.ownerId);
    return;
  }
  await reserveFreeWorkspaceCompute(workspaceId);
}
