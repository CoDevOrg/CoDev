import { withUser } from "@/lib/api-route";
import { syncWorkspaceToDefaultBranch } from "@/lib/workspaces";

// WorkspaceLifecycleError carries its own status; anything else is upstream.
export const POST = withUser<{ workspaceId: string }>(
  async ({ user, params: { workspaceId } }) =>
    Response.json({
      sync: await syncWorkspaceToDefaultBranch(workspaceId, user.id),
    }),
  { errorStatus: 502 },
);
