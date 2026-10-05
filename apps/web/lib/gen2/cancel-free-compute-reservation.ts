import "server-only";
import { eq } from "drizzle-orm";
import { schema } from "@codev/db";
import { getDatabase } from "../platform/database";
import { lockComputeOwners } from "./compute-database";
import { releaseFreeWorkspaceCompute } from "./free-compute-release";
import { Gen2LifecycleError } from "./errors";

export async function cancelFreeComputeReservation(
  workspaceId: string,
  ownerId: string,
) {
  await getDatabase().transaction(async (db) => {
    await lockComputeOwners(db, [ownerId]);
    const [row] = await db
      .select()
      .from(schema.gen2Workspaces)
      .where(eq(schema.gen2Workspaces.id, workspaceId))
      .for("update");
    if (!row || row.ownerId !== ownerId)
      throw new Gen2LifecycleError(
        "Only the current owner can stop this workspace.",
        403,
      );
    if (
      !["pending", "stopped"].includes(row.status) ||
      row.runtimeVmResourceId ||
      row.runtimeOperationId
    )
      throw new Gen2LifecycleError(
        "A lifecycle operation started. Try stopping the workspace again.",
        409,
      );
    await releaseFreeWorkspaceCompute(db, workspaceId);
  });
}
