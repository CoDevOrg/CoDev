import { withUser, readJson } from "@/lib/http/api-route";
import { startGen2AgentTurn, cancelGen2AgentTurn } from "@/lib/gen2/agent";
import {
  gen2AgentCancelRequestSchema,
  gen2AgentStartRequestSchema,
} from "@codev/contracts";

export const maxDuration = 60;

type Params = { workspaceId: string };

export const POST = withUser<Params>(
  async ({ request, user, params: { workspaceId } }) => {
    const input = await readJson(request, gen2AgentStartRequestSchema);
    return Response.json(
      await startGen2AgentTurn({
        workspaceId,
        userId: user.id,
        chatId: input.chatId,
        prompt: input.prompt,
        idempotencyKey: input.idempotencyKey,
      }),
    );
  },
  { errorStatus: 502 },
);

export const DELETE = withUser<Params>(
  async ({ request, user, params: { workspaceId } }) => {
    const input = await readJson(request, gen2AgentCancelRequestSchema);
    await cancelGen2AgentTurn({
      workspaceId,
      userId: user.id,
      sessionId: input.sessionId,
    });
    return Response.json({ ok: true });
  },
  { errorStatus: 502 },
);
