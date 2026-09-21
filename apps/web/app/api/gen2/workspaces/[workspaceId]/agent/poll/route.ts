import { withUser, readJson } from "@/lib/http/api-route";
import { pollGen2AgentTurn } from "@/lib/gen2/agent";
import { gen2AgentPollRequestSchema } from "@codev/contracts";

export const maxDuration = 60;

type Params = { workspaceId: string };

export const POST = withUser<Params>(
  async ({ request, user, params: { workspaceId } }) => {
    const input = await readJson(request, gen2AgentPollRequestSchema);
    return Response.json(
      await pollGen2AgentTurn({
        workspaceId,
        userId: user.id,
        ...(input.chatId ? { chatId: input.chatId } : {}),
        sessionId: input.sessionId,
        after: input.after,
      }),
    );
  },
  { errorStatus: 502 },
);
