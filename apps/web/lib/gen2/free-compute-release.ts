import "server-only";
import { eq } from "drizzle-orm";
import { schema } from "@codev/db";
import type { ComputeDatabase } from "./compute-database";

export async function releaseFreeWorkspaceCompute(
  db: ComputeDatabase,
  workspaceId: string,
) {
  await db
    .delete(schema.gen2FreeComputeClaims)
    .where(eq(schema.gen2FreeComputeClaims.workspaceId, workspaceId));
}
