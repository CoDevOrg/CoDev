import { withWorkspace } from "@/lib/http/api-route";
import {
  listCollaborationConflicts,
  reportCollaborationConflict,
} from "@/lib/workspaces/collaboration-server";
import { ensureWorkspaceRuntimeReady } from "@/lib/runtime/runtime-resume";

export const GET = withWorkspace("view", async ({ workspaceId }) =>
  Response.json({
    conflicts: await listCollaborationConflicts(workspaceId),
  }),
);

export const POST = withWorkspace(
  "edit",
  async ({ request, user, workspaceId }) => {
    await ensureWorkspaceRuntimeReady(workspaceId, user.id);
    return Response.json(
      await reportCollaborationConflict(workspaceId, await request.json()),
    );
  },
);
