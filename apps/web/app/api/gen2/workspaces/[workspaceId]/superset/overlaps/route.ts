import { listGen2AgentOverlaps } from "@/lib/gen2/agent-overlaps";
import { withUser } from "@/lib/http/api-route";

type Params = { workspaceId: string };

export const maxDuration = 60;

export const GET = withUser<Params>(
  async ({ user, params: { workspaceId } }) =>
    Response.json(await listGen2AgentOverlaps(workspaceId, user.id)),
  { errorStatus: 502 },
);
