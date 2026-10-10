import "server-only";

import { schema } from "@codev/db";
import { and, eq } from "drizzle-orm";

import { getDatabase } from "../platform/database";
import { workspaceRuntimeColumns } from "../runtime/workspace-runtime-target";
import { Gen2AccessError, Gen2LifecycleError } from "./errors";

/**
 * Preview permission and the guest route, read in one query (as terminal
 * access is). A preview reaches every dev server and debug endpoint the
 * member's processes expose, so it is editor-only, like the terminal.
 */
export async function gen2PreviewAccess(workspaceId: string, userId: string) {
  const [row] = await getDatabase()
    .select({
      role: schema.gen2WorkspaceMembers.role,
      workspaceStatus: schema.gen2Workspaces.status,
      tunnelId: schema.gen2Workspaces.runtimeTunnelId,
      ...workspaceRuntimeColumns,
    })
    .from(schema.gen2WorkspaceMembers)
    .innerJoin(
      schema.gen2Workspaces,
      eq(schema.gen2WorkspaceMembers.workspaceId, schema.gen2Workspaces.id),
    )
    .where(
      and(
        eq(schema.gen2WorkspaceMembers.workspaceId, workspaceId),
        eq(schema.gen2WorkspaceMembers.userId, userId),
      ),
    )
    .limit(1);
  if (!row) throw new Gen2AccessError();
  if (row.workspaceStatus === "deleting") {
    throw new Gen2LifecycleError("This workspace is being deleted.");
  }
  if (row.role === "viewer") {
    throw new Gen2AccessError("Only editors can open previews.", 403);
  }
  const { provider, status, generation, host, tunnelId } = row;
  return { provider, status, generation, host, tunnelId };
}
