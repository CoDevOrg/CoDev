import { withWorkspace } from "@/lib/http/api-route";
import { recordWorkspaceHeartbeat } from "@/lib/runtime/heartbeat";

export const POST = withWorkspace(
  "view",
  async ({ workspaceId }) =>
    Response.json(await recordWorkspaceHeartbeat(workspaceId)),
  { errorStatus: 502 },
);
