import { withWorkspace } from "@/lib/api-route";
import { resolveCollaborationConflict } from "@/lib/collaboration-server";
import { ensureWorkspaceRuntimeReady } from "@/lib/runtime-resume";

// CollaborationConflictResolutionError carries 409.
export const POST = withWorkspace(
  "edit",
  async ({ request, user, workspaceId }) => {
    await ensureWorkspaceRuntimeReady(workspaceId, user.id);
    return Response.json(
      await resolveCollaborationConflict(
        workspaceId,
        user.id,
        await request.json(),
      ),
    );
  },
);
