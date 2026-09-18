import { z } from "zod";

import { withUser } from "@/lib/api-route";
import {
  createWorkspaceInvite,
  listWorkspaceInviteState,
} from "@/lib/workspaces";

const inviteSchema = z.object({
  invitee: z.string().trim().max(320).optional(),
  accessRole: z.enum(["co_steer", "reviewer", "viewer"]).default("co_steer"),
  allowLink: z.boolean().default(false),
});

type Params = { workspaceId: string };

export const GET = withUser<Params>(async ({ user, params: { workspaceId } }) =>
  Response.json(await listWorkspaceInviteState(workspaceId, user.id)),
);

export const POST = withUser<Params>(
  async ({ request, user, params: { workspaceId } }) => {
    const body = await request.json().catch(() => ({}));
    const input = inviteSchema.parse(body);
    const invitee = input.invitee?.trim() || null;
    const invite = await createWorkspaceInvite(workspaceId, user.id, {
      accessRole: input.accessRole,
      allowLink: input.allowLink || !invitee,
      ...(invitee?.includes("@")
        ? { inviteeEmail: invitee }
        : invitee
          ? { inviteeLogin: invitee.replace(/^@/, "") }
          : {}),
    });
    const origin = new URL(request.url).origin;
    const state = await listWorkspaceInviteState(workspaceId, user.id);
    return Response.json({
      inviteId: invite.id,
      inviteUrl: `${origin}/invites/${invite.token}`,
      expiresInHours: 24,
      expiresAt: invite.expiresAt.toISOString(),
      status: "pending",
      accessRole: invite.accessRole,
      ...state,
    });
  },
);
