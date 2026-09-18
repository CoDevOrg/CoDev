import { updateBrainOverlapSchema } from "@codev/contracts";

import { withWorkspace } from "@/lib/api-route";
import { updateOverlapStatus } from "@/lib/workspace-brain";

export const PATCH = withWorkspace<{ workspaceId: string; overlapId: string }>(
  "coSteer",
  async ({ request, workspaceId, params: { overlapId } }) => {
    const { status } = updateBrainOverlapSchema.parse(await request.json());
    return Response.json({
      overlap: await updateOverlapStatus(workspaceId, overlapId, status),
    });
  },
);
