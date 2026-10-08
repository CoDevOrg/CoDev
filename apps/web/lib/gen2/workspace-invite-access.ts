import "server-only";
import { and, eq } from "drizzle-orm";
import { schema } from "@codev/db";
import type { Gen2WorkspaceRole } from "@codev/contracts";
import type { ComputeTransaction } from "./compute-database";
import { Gen2AccessError } from "./errors";

/** Lock the same row removal updates, then revalidate the invitation before admission. */
export async function requireActiveWorkspaceInvite(
  tx: ComputeTransaction,
  workspaceId: string,
  tokenHash: string,
  role: Gen2WorkspaceRole,
) {
  const [workspace] = await tx
    .select({
      expiresAt: schema.gen2Workspaces.activeInviteExpiresAt,
      role: schema.gen2Workspaces.activeInviteRole,
      status: schema.gen2Workspaces.status,
    })
    .from(schema.gen2Workspaces)
    .where(
      and(
        eq(schema.gen2Workspaces.id, workspaceId),
        eq(schema.gen2Workspaces.activeInviteTokenHash, tokenHash),
      ),
    )
    .for("update");
  if (
    !workspace ||
    workspace.status === "deleting" ||
    !workspace.expiresAt ||
    workspace.expiresAt.getTime() <= Date.now() ||
    (workspace.role ?? "editor") !== role
  ) {
    throw new Gen2AccessError("This invite link is no longer valid.", 404);
  }
}
