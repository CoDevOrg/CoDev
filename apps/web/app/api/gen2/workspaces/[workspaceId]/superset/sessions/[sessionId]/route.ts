import { withUser } from "@/lib/http/api-route";
import { getGen2AgentSessionMetadata } from "@/lib/gen2/agent-session-list";

type Params = { workspaceId: string; sessionId: string };

export const maxDuration = 60;

export const GET = withUser<Params>(
  async ({ user, params: { workspaceId, sessionId } }) =>
    Response.json({
      session: await getGen2AgentSessionMetadata(
        workspaceId,
        user.id,
        sessionId,
      ),
    }),
  { errorStatus: 502 },
);
