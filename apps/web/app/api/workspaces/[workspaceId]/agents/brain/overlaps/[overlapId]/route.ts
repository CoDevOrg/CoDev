import { updateBrainOverlapSchema } from "@codev/contracts";

import { withWorkspace } from "@/lib/http/api-route";
import { updateOverlapStatus } from "@/lib/coordination/workspace-brain";

export const PATCH = withWorkspace<{ workspaceId: string; overlapId: string }>(
  "coSteer",
  async ({ request, workspaceId, params: { overlapId } }) => {
    const { status } = updateBrainOverlapSchema.parse(await request.json());
    return Response.json({
      overlap: await updateOverlapStatus(workspaceId, overlapId, status),
    });
  },
);
