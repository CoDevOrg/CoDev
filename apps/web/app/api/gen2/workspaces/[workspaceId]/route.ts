import { withUser } from "@/lib/http/api-route";
import { getGen2WorkspaceDetail } from "@/lib/gen2/workspaces";

type Params = { workspaceId: string };

export const GET = withUser<Params>(async ({ user, params: { workspaceId } }) =>
  Response.json({
    workspace: await getGen2WorkspaceDetail(workspaceId, user.id),
  }),
);
