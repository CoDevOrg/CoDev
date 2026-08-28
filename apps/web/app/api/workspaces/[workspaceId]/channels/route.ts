import { createChannelSchema } from "@codev/contracts";

import { requireWorkspacePermission } from "@/lib/access";
import { apiError, getApiUser } from "@/lib/api";
import {
  createWorkspaceChannel,
  listWorkspaceChannels,
  TeamChatError,
} from "@/lib/team-chat";

type Context = { params: Promise<{ workspaceId: string }> };

function statusFor(error: unknown, fallback = 400) {
  return error instanceof Error && "status" in error
    ? Number(error.status)
    : fallback;
}

export async function GET(_request: Request, { params }: Context) {
  const user = await getApiUser();
  if (!user) return apiError(new Error("Authentication required."), 401);
  const { workspaceId } = await params;
  try {
    await requireWorkspacePermission(workspaceId, user.id, "view");
    return Response.json({
      channels: await listWorkspaceChannels(workspaceId, user.id),
    });
  } catch (error) {
    return apiError(error, statusFor(error));
  }
}

export async function POST(request: Request, { params }: Context) {
  const user = await getApiUser();
  if (!user) return apiError(new Error("Authentication required."), 401);
  const { workspaceId } = await params;
  try {
    // Reading a channel is a viewer right; adding one to the workspace's
    // shared structure is not.
    await requireWorkspacePermission(workspaceId, user.id, "edit");
    const input = createChannelSchema.parse(await request.json());
    const channel = await createWorkspaceChannel(workspaceId, user.id, input);
    return Response.json({ channel }, { status: 201 });
  } catch (error) {
    if (error instanceof TeamChatError) return apiError(error, error.status);
    return apiError(error, statusFor(error));
  }
}
