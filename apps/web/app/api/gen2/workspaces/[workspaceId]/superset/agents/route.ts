import { gen2SupersetAgentStartRequestSchema } from "@codev/contracts";

import { readJson, withUser } from "@/lib/http/api-route";
import { listGen2SupersetAgentRuns } from "@/lib/gen2/superset-agent-list";
import { startGen2SupersetPersistentAgent } from "@/lib/gen2/superset-agent-runtime";

type Params = { workspaceId: string };

export const maxDuration = 60;

export const GET = withUser<Params>(
  async ({ user, params: { workspaceId } }) =>
    Response.json({
      runs: await listGen2SupersetAgentRuns(workspaceId, user.id),
    }),
  { errorStatus: 502 },
);

export const POST = withUser<Params>(
  async ({ request, user, params: { workspaceId } }) => {
    const input = await readJson(request, gen2SupersetAgentStartRequestSchema);
    const run = await startGen2SupersetPersistentAgent({
      workspaceId,
      userId: user.id,
      ...input,
    });
    return Response.json(run, { status: 201 });
  },
  { errorStatus: 502 },
);
