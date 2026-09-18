import { withWorkspace } from "@/lib/http/api-route";
import {
  getAgentBrief,
  updateAgentBrief,
} from "@/lib/coordination/workspace-brain";

type Params = { workspaceId: string; sessionId: string };

export const GET = withWorkspace<Params>(
  "view",
  async ({ workspaceId, params: { sessionId } }) =>
    Response.json({ brief: await getAgentBrief(workspaceId, sessionId) }),
);

export const PUT = withWorkspace<Params>(
  "coSteer",
  async ({ request, workspaceId, params: { sessionId } }) =>
    Response.json({
      brief: await updateAgentBrief(
        workspaceId,
        sessionId,
        await request.json(),
      ),
    }),
);
