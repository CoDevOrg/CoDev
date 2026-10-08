import "server-only";

import { schema } from "@codev/db";
import { and, eq } from "drizzle-orm";

import { getDatabase } from "../platform/database";
import { workspaceRuntimeColumns } from "../runtime/workspace-runtime-target";
import { Gen2AccessError, Gen2LifecycleError } from "./errors";

export type Gen2TerminalAccess = Awaited<ReturnType<typeof gen2TerminalAccess>>;

/**
 * Live terminal permission, read with the guest route in one query so each
 * socket input and output poll pays a single database round trip. Never
 * reuse a result: check again before every input, resize, poll, and delivery.
 */
export async function gen2TerminalAccess(workspaceId: string, userId: string) {
  const [row] = await getDatabase()
    .select({
      role: schema.gen2WorkspaceMembers.role,
      workspaceStatus: schema.gen2Workspaces.status,
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
    throw new Gen2AccessError(
      "Edit permission is required to access terminals.",
      403,
    );
  }
  const { provider, status, generation, host } = row;
  return { provider, status, generation, host };
}
