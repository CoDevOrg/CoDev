import { withUser } from "@/lib/http/api-route";
import { startGen2Instance, stopGen2Instance } from "@/lib/gen2/instance";
import { getGen2WorkspaceDetail } from "@/lib/gen2/workspaces";

export const maxDuration = 300;

type Params = { workspaceId: string };

export const POST = withUser<Params>(
  async ({ user, params: { workspaceId } }) => {
    await startGen2Instance(workspaceId, user.id);
    return Response.json({
      workspace: await getGen2WorkspaceDetail(workspaceId, user.id),
    });
  },
  { errorStatus: 502 },
);

export const DELETE = withUser<Params>(
  async ({ user, params: { workspaceId } }) => {
    await stopGen2Instance(workspaceId, user.id);
    return Response.json({
      workspace: await getGen2WorkspaceDetail(workspaceId, user.id),
    });
  },
  { errorStatus: 502 },
);
