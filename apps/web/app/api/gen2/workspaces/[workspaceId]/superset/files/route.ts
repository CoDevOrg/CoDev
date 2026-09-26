import { gen2SupersetWorktreeIdSchema } from "@codev/contracts";

import { listGen2SupersetFiles } from "@/lib/gen2/superset";
import { ApiError, withUser } from "@/lib/http/api-route";

type Params = { workspaceId: string };

export const maxDuration = 60;

export const GET = withUser<Params>(
  async ({ request, user, params: { workspaceId } }) => {
    const worktreeId = new URL(request.url).searchParams.get("worktreeId");
    const parsed = gen2SupersetWorktreeIdSchema.safeParse(worktreeId);
    if (!parsed.success) throw new ApiError("Invalid worktree ID.");
    return Response.json({
      files: await listGen2SupersetFiles(workspaceId, user.id, parsed.data),
    });
  },
  { errorStatus: 502 },
);
