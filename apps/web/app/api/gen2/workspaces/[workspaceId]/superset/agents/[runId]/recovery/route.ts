import { withUser } from "@/lib/http/api-route";
import { reconcileGen2SupersetAgentSession } from "@/lib/gen2/superset-agent-runtime";

type Params = { workspaceId: string; runId: string };

export const maxDuration = 60;

export const POST = withUser<Params>(
  async ({ user, params: { workspaceId, runId } }) =>
    Response.json(
      await reconcileGen2SupersetAgentSession({
        workspaceId,
        userId: user.id,
        runId,
      }),
    ),
  { errorStatus: 502 },
);
