import { readJson, withUser } from "@/lib/http/api-route";
import { listGen2AgentSessionMetadata } from "@/lib/gen2/agent-session-list";
import { createGen2AgentSessionTask } from "@/lib/gen2/superset-agent-runtime";
import { gen2AgentStartRequestSchema } from "@codev/contracts";

type Params = { workspaceId: string };

export const maxDuration = 60;

export const GET = withUser<Params>(
  async ({ user, params: { workspaceId } }) =>
    Response.json({
      sessions: await listGen2AgentSessionMetadata(workspaceId, user.id),
    }),
  { errorStatus: 502 },
);

export const POST = withUser<Params>(
  async ({ request, user, params: { workspaceId } }) => {
    const input = await readJson(request, gen2AgentStartRequestSchema);
    return Response.json(
      await createGen2AgentSessionTask({
        workspaceId,
        userId: user.id,
        chatId: input.chatId,
        task: input.prompt,
        provider: input.provider,
        idempotencyKey: input.idempotencyKey,
        worktreeId: input.worktreeId,
        model: input.model,
      }),
      { status: 201 },
    );
  },
  { errorStatus: 502 },
);
