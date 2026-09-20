import { ApiError, withWorkspace } from "@/lib/http/api-route";
import { prepareOrcaWorkspace } from "@/lib/runtime/orca-host";
import { getWorkspaceForMember } from "@/lib/workspaces/workspaces";

export const maxDuration = 300;

/**
 * Prepare the workspace directory and repository without starting Orca.
 * Dashboard pointer-down calls this after the host wake signal has already
 * started, allowing the clone to overlap navigation and page hydration.
 */
export const POST = withWorkspace(
  "view",
  async ({ user, workspaceId }) => {
    const workspace = await getWorkspaceForMember(workspaceId, user.id);
    if (!workspace) throw new ApiError("Workspace not found.", 404);

    const state = await prepareOrcaWorkspace(workspace, user.id);
    return Response.json(
      { state },
      {
        status: state === "prepared" ? 200 : 202,
        headers: { "Cache-Control": "no-store" },
      },
    );
  },
  { errorStatus: 502 },
);
