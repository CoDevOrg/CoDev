import { ApiError, withUser } from "@/lib/api-route";
import { deleteWorkspace, getWorkspaceForMember } from "@/lib/workspaces";

type Params = { workspaceId: string };

export const GET = withUser<Params>(
  async ({ user, params: { workspaceId } }) => {
    const workspace = await getWorkspaceForMember(workspaceId, user.id);
    if (!workspace) throw new ApiError("Workspace not found.", 404);
    return Response.json({ workspace });
  },
  { anyAuth: true, errorStatus: 500 },
);

export const DELETE = withUser<Params>(
  async ({ user, params: { workspaceId } }) => {
    await deleteWorkspace(workspaceId, user.id);
    return Response.json({ success: true, workspaceId });
  },
  { errorStatus: 500 },
);
