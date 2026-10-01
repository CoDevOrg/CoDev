import "server-only";

import { eq } from "drizzle-orm";

import { schema } from "@codev/db";

import { getDatabase } from "../platform/database";
import { requireIndividualPlan } from "./access";

/**
 * Paywall for compute in a Gen 2 workspace. The owner pays for the machine,
 * so a collaborator in a paid owner's workspace needs no plan of their own,
 * and a lapsed owner blocks compute for every member. A workspace that does
 * not exist is left to the caller's own membership check (404).
 */
export async function requireWorkspaceOwnerPlan(workspaceId: string) {
  const [workspace] = await getDatabase()
    .select({ ownerId: schema.gen2Workspaces.ownerId })
    .from(schema.gen2Workspaces)
    .where(eq(schema.gen2Workspaces.id, workspaceId))
    .limit(1);
  if (!workspace) return;
  await requireIndividualPlan(workspace.ownerId);
}
