import { gen2SupersetWorktreeIdSchema } from "@codev/contracts";

import { listGen2SupersetExternalFileChanges } from "@/lib/gen2/superset";
import { ApiError, withUser } from "@/lib/http/api-route";

type Params = { workspaceId: string };

export const maxDuration = 60;

/** Polled by the Gen 2 collaboration client; never called by the host directly. */
export const GET = withUser<Params>(
  async ({ request, user, params: { workspaceId } }) => {
    const worktreeId = new URL(request.url).searchParams.get("worktreeId");
    const parsed = gen2SupersetWorktreeIdSchema.safeParse(worktreeId);
    if (!parsed.success) throw new ApiError("Invalid worktree ID.");
    return Response.json({
      changes: await listGen2SupersetExternalFileChanges(
        workspaceId,
        user.id,
        parsed.data,
      ),
    });
  },
  { errorStatus: 502 },
);
