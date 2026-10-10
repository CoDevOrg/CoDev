import { withUser, readJson } from "@/lib/http/api-route";
import { driveGen2AgentTurn } from "@/lib/gen2/agent-turn-drive";
import { gen2AgentDriveRequestSchema } from "@codev/contracts";

export const maxDuration = 60;

type Params = { workspaceId: string };

export const POST = withUser<Params>(
  async ({ request, user, params: { workspaceId } }) => {
    const input = await readJson(request, gen2AgentDriveRequestSchema);
    const polled = await driveGen2AgentTurn({
      workspaceId,
      userId: user.id,
      sessionId: input.sessionId,
    });
    return Response.json({ polled });
  },
  { errorStatus: 502 },
);
