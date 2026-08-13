import { apiError, getApiUser } from "@/lib/api";
import {
  createWorkspaceInvite,
  listWorkspaceInviteState,
} from "@/lib/workspaces";
import { z } from "zod";

const inviteSchema = z.object({
  invitee: z.string().trim().max(320).optional(),
  accessRole: z.enum(["co_steer", "reviewer", "viewer"]).default("co_steer"),
  allowLink: z.boolean().default(false),
});

export async function GET(
  _request: Request,
  context: { params: Promise<{ workspaceId: string }> },
) {
  const user = await getApiUser();
  if (!user) return apiError(new Error("Authentication required."), 401);

  try {
    const { workspaceId } = await context.params;
    return Response.json(await listWorkspaceInviteState(workspaceId, user.id));
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ workspaceId: string }> },
) {
  const user = await getApiUser();
  if (!user) return apiError(new Error("Authentication required."), 401);

  try {
    const { workspaceId } = await context.params;
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
  } catch (error) {
    return apiError(error);
  }
}
