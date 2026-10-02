import { withUser } from "@/lib/http/api-route";
import { listGen2SupersetAgentRuns } from "@/lib/gen2/superset-agent-list";

type Params = { workspaceId: string };

export const maxDuration = 60;

export const GET = withUser<Params>(
  async ({ user, params: { workspaceId } }) => {
    const runs = await listGen2SupersetAgentRuns(workspaceId, user.id);
    return Response.json({ runs });
  },
  { errorStatus: 502 },
);
