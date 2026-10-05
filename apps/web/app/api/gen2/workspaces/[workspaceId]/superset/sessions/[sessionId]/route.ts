import { readJson, withUser } from "@/lib/http/api-route";
import { getGen2AgentSessionMetadata } from "@/lib/gen2/agent-session-list";
import {
  sendGen2AgentSessionFollowUp,
  stopGen2AgentSession,
} from "@/lib/gen2/superset-agent-runtime";
import { gen2AgentSessionFollowUpRequestSchema } from "@codev/contracts";

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

export const POST = withUser<Params>(
  async ({ request, user, params: { workspaceId, sessionId } }) => {
    const input = await readJson(
      request,
      gen2AgentSessionFollowUpRequestSchema,
    );
    await sendGen2AgentSessionFollowUp({
      workspaceId,
      userId: user.id,
      sessionId,
      data: input.data,
    });
    return new Response(null, { status: 204 });
  },
  { errorStatus: 502 },
);

export const DELETE = withUser<Params>(
  async ({ user, params: { workspaceId, sessionId } }) => {
    await stopGen2AgentSession({ workspaceId, userId: user.id, sessionId });
    return new Response(null, { status: 204 });
  },
  { errorStatus: 502 },
);
