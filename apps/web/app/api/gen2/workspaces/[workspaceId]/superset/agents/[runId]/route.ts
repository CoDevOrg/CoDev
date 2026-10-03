import { gen2SupersetAgentInputRequestSchema } from "@codev/contracts";

import { readJson, withUser } from "@/lib/http/api-route";
import {
  cancelGen2SupersetAgentSession,
  sendGen2SupersetAgentInput,
} from "@/lib/gen2/superset-agent-runtime";

type Params = { workspaceId: string; runId: string };

export const maxDuration = 60;

export const POST = withUser<Params>(
  async ({ request, user, params: { workspaceId, runId } }) => {
    const input = await readJson(request, gen2SupersetAgentInputRequestSchema);
    await sendGen2SupersetAgentInput({
      workspaceId,
      userId: user.id,
      runId,
      data: input.data,
    });
    return Response.json({ ok: true });
  },
  { errorStatus: 502 },
);

export const DELETE = withUser<Params>(
  async ({ user, params: { workspaceId, runId } }) => {
    await cancelGen2SupersetAgentSession({
      workspaceId,
      userId: user.id,
      runId,
    });
    return Response.json({ ok: true });
  },
  { errorStatus: 502 },
);
