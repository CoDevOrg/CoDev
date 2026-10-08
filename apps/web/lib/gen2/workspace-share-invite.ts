import "server-only";
import { eq } from "drizzle-orm";
import { schema } from "@codev/db";
import type { Gen2WorkspaceRole } from "@codev/contracts";
import { getDatabase } from "../platform/database";
import { createInviteToken, hashInviteToken } from "../platform/crypto";
import { Gen2AccessError } from "./errors";

/** Opening sharing reuses the current capability; only a role change or expiry replaces it. */
export async function getOrCreateWorkspaceShareInvite(
  workspaceId: string,
  userId: string,
  requestedRole?: Exclude<Gen2WorkspaceRole, "owner">,
) {
  return getDatabase().transaction(async (tx) => {
    const [workspace] = await tx
      .select({
        hash: schema.gen2Workspaces.activeInviteTokenHash,
        role: schema.gen2Workspaces.activeInviteRole,
        expiresAt: schema.gen2Workspaces.activeInviteExpiresAt,
      })
      .from(schema.gen2Workspaces)
      .where(eq(schema.gen2Workspaces.id, workspaceId))
      .for("update");
    if (!workspace) throw new Gen2AccessError();
    const role =
      requestedRole ?? (workspace.role === "viewer" ? "viewer" : "editor");
    if (
      workspace.hash &&
      workspace.role === role &&
      workspace.expiresAt &&
      workspace.expiresAt.getTime() > Date.now()
    )
      return { hash: workspace.hash, role };
    const hash = hashInviteToken(createInviteToken());
    const createdAt = new Date();
    await tx
      .update(schema.gen2Workspaces)
      .set({
        activeInviteTokenHash: hash,
        activeInviteCreatedByUserId: userId,
        activeInviteRole: role,
        activeInviteCreatedAt: createdAt,
        activeInviteExpiresAt: new Date(
          createdAt.getTime() + 7 * 24 * 60 * 60 * 1000,
        ),
        updatedAt: createdAt,
      })
      .where(eq(schema.gen2Workspaces.id, workspaceId));
    return { hash, role };
  });
}
