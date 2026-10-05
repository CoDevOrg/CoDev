import { withUser } from "@/lib/http/api-route";
import { getGen2SupersetAgentRun } from "@/lib/gen2/superset-agent-list";
import { cancelGen2SupersetAgentSession } from "@/lib/gen2/superset-agent-runtime";

type Params = { workspaceId: string; runId: string };

export const maxDuration = 60;

export const GET = withUser<Params>(
  async ({ user, params: { workspaceId, runId } }) =>
    Response.json({
      session: await getGen2SupersetAgentRun(workspaceId, user.id, runId),
    }),
  { errorStatus: 502 },
);

export const DELETE = withUser<Params>(
  async ({ user, params: { workspaceId, runId } }) => {
    await cancelGen2SupersetAgentSession({
      workspaceId,
      userId: user.id,
      runId,
    });
    return new Response(null, { status: 204 });
  },
  { errorStatus: 502 },
);
