import { z } from "zod";

import { ApiError, withUser } from "@/lib/http/api-route";
import {
  leaveWorkspace,
  listWorkspaceMembers,
  updateMemberAccessRole,
  updateMemberCapabilities,
} from "@/lib/workspaces/workspaces";

const requestSchema = z.object({
  accessRole: z.enum(["co_steer", "reviewer", "viewer"]).optional(),
  canTerminal: z.boolean().optional(),
  canMerge: z.boolean().optional(),
});

type Params = { workspaceId: string; userId: string };

export const PATCH = withUser<Params>(
  async ({ request, user, params: { workspaceId, userId } }) => {
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
      throw new ApiError("A member role is required.", 400);
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
  },
);

export const DELETE = withUser<Params>(
  async ({ user, params: { workspaceId, userId } }) => {
    if (userId !== user.id) {
      throw new ApiError("You can only remove your own membership here.", 403);
    }
    await leaveWorkspace(workspaceId, user.id);
    return Response.json({ ok: true, workspaceId, userId });
  },
  { errorStatus: 500 },
);
