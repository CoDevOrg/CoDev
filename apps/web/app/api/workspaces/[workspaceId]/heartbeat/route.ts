import { withWorkspace } from "@/lib/api-route";
import { recordWorkspaceHeartbeat } from "@/lib/heartbeat";

export const POST = withWorkspace(
  "view",
  async ({ workspaceId }) =>
    Response.json(await recordWorkspaceHeartbeat(workspaceId)),
  { errorStatus: 502 },
);
