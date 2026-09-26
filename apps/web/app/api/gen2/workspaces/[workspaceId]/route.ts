import { withUser } from "@/lib/http/api-route";
import {
  deleteGen2Workspace,
  getGen2WorkspaceDetail,
} from "@/lib/gen2/workspaces";

type Params = { workspaceId: string };

export const GET = withUser<Params>(async ({ user, params: { workspaceId } }) =>
  Response.json({
    workspace: await getGen2WorkspaceDetail(workspaceId, user.id),
  }),
);

export const DELETE = withUser<Params>(
  async ({ user, params: { workspaceId } }) => {
    await deleteGen2Workspace(workspaceId, user.id);
    return Response.json({ success: true, workspaceId });
  },
  { errorStatus: 502 },
);
