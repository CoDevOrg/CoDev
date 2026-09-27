import { gen2SupersetWorktreeCreateRequestSchema } from "@codev/contracts";

import {
  createGen2SupersetWorktree,
  listGen2SupersetWorktrees,
} from "@/lib/gen2/superset";
import { readJson, withUser } from "@/lib/http/api-route";

type Params = { workspaceId: string };

export const maxDuration = 60;

export const GET = withUser<Params>(
  async ({ user, params: { workspaceId } }) =>
    Response.json({
      worktrees: await listGen2SupersetWorktrees(workspaceId, user.id),
    }),
  { errorStatus: 502 },
);

export const POST = withUser<Params>(
  async ({ request, user, params: { workspaceId } }) => {
    const input = await readJson(
      request,
      gen2SupersetWorktreeCreateRequestSchema,
    );
    return Response.json(
      {
        worktree: await createGen2SupersetWorktree(workspaceId, user.id, input),
      },
      { status: 201 },
    );
  },
  { errorStatus: 502 },
);
