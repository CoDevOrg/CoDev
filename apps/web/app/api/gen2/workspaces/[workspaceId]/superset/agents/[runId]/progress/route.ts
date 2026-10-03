import { gen2SupersetAgentPollRequestSchema } from "@codev/contracts";

import { readJson, withUser } from "@/lib/http/api-route";
import {
  getGen2SupersetAgentProgress,
  pollGen2SupersetAgentProgress,
} from "@/lib/gen2/superset-agent-runtime";

type Params = { workspaceId: string; runId: string };

export const maxDuration = 60;

export const GET = withUser<Params>(
  async ({ request, user, params: { workspaceId, runId } }) => {
    const after = Number(new URL(request.url).searchParams.get("after") ?? 0);
    const input = gen2SupersetAgentPollRequestSchema.safeParse({ after });
    if (!input.success) {
      return Response.json({ error: "Invalid cursor." }, { status: 400 });
    }
    return Response.json(
      await getGen2SupersetAgentProgress({
        workspaceId,
        userId: user.id,
        runId,
        after: input.data.after,
      }),
    );
  },
  { errorStatus: 502 },
);

export const POST = withUser<Params>(
  async ({ request, user, params: { workspaceId, runId } }) => {
    const input = await readJson(request, gen2SupersetAgentPollRequestSchema);
    return Response.json(
      await pollGen2SupersetAgentProgress({
        workspaceId,
        userId: user.id,
        runId,
        after: input.after,
      }),
    );
  },
  { errorStatus: 502 },
);
