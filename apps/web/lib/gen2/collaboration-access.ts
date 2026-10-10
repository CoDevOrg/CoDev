import "server-only";

import { and, eq, inArray, ne } from "drizzle-orm";
import { schema } from "@codev/db";

import { getDatabase } from "../platform/database";

/**
 * Which of `userIds` may still receive this workspace's collaboration data.
 * One query per broadcast instead of one per recipient: cursor and presence
 * fan-out runs on every keystroke, and each query costs a cross-region trip.
 */
export async function listGen2LiveMemberIds(
  workspaceId: string,
  userIds: string[],
) {
  if (!userIds.length) return new Set<string>();
  const rows = await getDatabase()
    .select({ userId: schema.gen2WorkspaceMembers.userId })
    .from(schema.gen2WorkspaceMembers)
    .innerJoin(
      schema.gen2Workspaces,
      eq(schema.gen2WorkspaceMembers.workspaceId, schema.gen2Workspaces.id),
    )
    .where(
      and(
        eq(schema.gen2WorkspaceMembers.workspaceId, workspaceId),
        inArray(schema.gen2WorkspaceMembers.userId, [...new Set(userIds)]),
        ne(schema.gen2Workspaces.status, "deleting"),
      ),
    );
  return new Set(rows.map((row) => row.userId));
}
