import { withUser } from "@/lib/http/api-route";
import { listGen2AgentSessionMetadata } from "@/lib/gen2/agent-session-list";

type Params = { workspaceId: string };

export const maxDuration = 60;

export const GET = withUser<Params>(
  async ({ user, params: { workspaceId } }) =>
    Response.json({
      sessions: await listGen2AgentSessionMetadata(workspaceId, user.id),
    }),
  { errorStatus: 502 },
);
