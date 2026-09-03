import { z } from "zod";

import { apiError, getApiUser } from "@/lib/api";
import {
  leaveWorkspace,
  listWorkspaceMembers,
  updateMemberAccessRole,
  updateMemberCapabilities,
} from "@/lib/workspaces";

const requestSchema = z.object({
  accessRole: z.enum(["co_steer", "reviewer", "viewer"]).optional(),
  canTerminal: z.boolean().optional(),
  canMerge: z.boolean().optional(),
});

export async function PATCH(
  request: Request,
  context: { params: Promise<{ workspaceId: string; userId: string }> },
) {
  const user = await getApiUser();
  if (!user) return apiError(new Error("Authentication required."), 401);

  try {
    const { workspaceId, userId } = await context.params;
    const capabilities = requestSchema.parse(await request.json());
    if (capabilities.accessRole) {
      await updateMemberAccessRole(
        workspaceId,
        userId,
        user.id,
        capabilities.accessRole,
      );
    } else if (
      capabilities.canTerminal !== undefined &&
      capabilities.canMerge !== undefined
    ) {
      await updateMemberCapabilities(workspaceId, userId, user.id, {
        canTerminal: capabilities.canTerminal,
        canMerge: capabilities.canMerge,
      });
    } else {
      return apiError(new Error("A member role is required."), 400);
    }
    const members = await listWorkspaceMembers(workspaceId);
    return Response.json({
      ok: true,
      members: members.map((member) => ({
        userId: member.userId,
        login: member.login,
        name: member.name,
        role: member.role,
        accessRole: member.accessRole,
      })),
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ workspaceId: string; userId: string }> },
) {
  const user = await getApiUser();
  if (!user) return apiError(new Error("Authentication required."), 401);

  const { workspaceId, userId } = await context.params;
  if (userId !== user.id) {
    return apiError(
      new Error("You can only remove your own membership here."),
      403,
    );
  }

  try {
    await leaveWorkspace(workspaceId, user.id);
    return Response.json({ ok: true, workspaceId, userId });
  } catch (error) {
    return apiError(
      error,
      error instanceof Error && "status" in error ? Number(error.status) : 500,
    );
  }
}
